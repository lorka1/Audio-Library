import { createHash } from 'node:crypto';
import { access, lstat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
	SQLITE_MONGODB_MIGRATION_ID,
	TRACK_PUBLIC_ID_COUNTER
} from '../../src/lib/server/mongodb/documents.ts';
import { MONGODB_INDEX_DEFINITIONS } from '../../src/lib/server/mongodb/indexes.ts';

export const MIGRATION_VERSION = 1;
export const MIGRATION_CONFIRMATION = 'MIGRATE_SQLITE_TO_MONGODB';
export const MIGRATION_OPERATION_TIMEOUT_MS = 8_000;

const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STORAGE_KEY_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:mp3|wav|ogg)$/;
const VISIBILITIES = new Set(['private', 'public']);

export class MigrationValidationError extends Error {
	constructor(categories) {
		super(`Migration preflight failed in ${categories.length} safe error categories.`);
		this.name = 'MigrationValidationError';
		this.categories = [...categories];
	}
}

function duplicateCount(values) {
	const seen = new Set();
	let duplicates = 0;
	for (const value of values) {
		if (seen.has(value)) duplicates += 1;
		else seen.add(value);
	}
	return duplicates;
}

function safeDate(seconds) {
	const numeric = Number(seconds);
	const date = new Date(numeric * 1_000);
	return Number.isSafeInteger(numeric) && !Number.isNaN(date.getTime())
		? date
		: null;
}

function canonicalize(snapshot) {
	return {
		users: [...snapshot.users]
			.sort((left, right) => left._id.localeCompare(right._id))
			.map((user) => ({
				_id: user._id,
				username: user.username,
				email: user.email,
				passwordHash: user.passwordHash,
				createdAt: user.createdAt.toISOString(),
				updatedAt: user.updatedAt.toISOString()
			})),
		tracks: [...snapshot.tracks]
			.sort((left, right) => left.publicId - right.publicId)
			.map((track) => ({
				...track,
				createdAt: track.createdAt.toISOString(),
				updatedAt: track.updatedAt.toISOString()
			}))
	};
}

export function migrationFingerprint(snapshot) {
	return createHash('sha256')
		.update(JSON.stringify(canonicalize(snapshot)))
		.digest('hex');
}

export function resolveSqliteSource(databaseUrl, workingDirectory = process.cwd()) {
	const configured = databaseUrl?.trim();
	if (!configured) throw new Error('Missing required environment variable DATABASE_URL.');
	if (/^[a-z][a-z0-9+.-]*:/i.test(configured) && !configured.startsWith('file:')) {
		throw new Error('Migration source must be a local SQLite file.');
	}
	const path = configured.startsWith('file:')
		? decodeURIComponent(new URL(configured).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
		: configured;
	return resolve(workingDirectory, path);
}

function safeStoragePath(audioRoot, storageKey) {
	if (!STORAGE_KEY_PATTERN.test(storageKey)) return null;
	const root = resolve(audioRoot);
	const path = resolve(root, storageKey);
	const within = relative(root, path);
	if (
		!within ||
		within === '..' ||
		within.startsWith(`..${sep}`) ||
		isAbsolute(within)
	) {
		return null;
	}
	return path;
}

export async function readSqliteMigrationSnapshot({
	sourcePath,
	audioStoragePath
}) {
	await access(sourcePath);
	const sqlite = new DatabaseSync(sourcePath, {
		open: true,
		readOnly: true,
		enableForeignKeyConstraints: true
	});
	try {
		const userRows = sqlite.prepare(`select
				id, username, email, password_hash, created_at, updated_at
				from users order by id`).all();
		const trackRows = sqlite.prepare(`select
				public_id, id, owner_id, title, artist, bpm, musical_key, genre,
				description, original_filename, storage_key, mime_type,
				file_size_bytes, duration_ms, visibility, created_at, updated_at
				from tracks order by public_id`).all();
		const sessionRow = sqlite
			.prepare('select count(*) as count from sessions')
			.get();
		const users = userRows.map((row) => ({
			_id: String(row.id),
			username: String(row.username),
			email: String(row.email),
			passwordHash: String(row.password_hash),
			createdAt: safeDate(row.created_at),
			updatedAt: safeDate(row.updated_at)
		}));
		const tracks = trackRows.map((row) => ({
			_id: String(row.id),
			publicId: Number(row.public_id),
			ownerId: String(row.owner_id),
			title: String(row.title),
			artist: String(row.artist),
			bpm: row.bpm === null ? null : Number(row.bpm),
			musicalKey: row.musical_key === null ? null : String(row.musical_key),
			genre: row.genre === null ? null : String(row.genre),
			description: row.description === null ? null : String(row.description),
			originalFilename: String(row.original_filename),
			storageKey: String(row.storage_key),
			mimeType: String(row.mime_type),
			fileSizeBytes: Number(row.file_size_bytes),
			durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
			visibility: String(row.visibility),
			createdAt: safeDate(row.created_at),
			updatedAt: safeDate(row.updated_at)
		}));
		const storageChecks = await Promise.all(
			tracks.map(async (track) => {
				const path = safeStoragePath(audioStoragePath, track.storageKey);
				if (!path) return false;
				try {
					return (await lstat(path)).isFile();
				} catch {
					return false;
				}
			})
		);
		const snapshot = {
			users,
			tracks,
			sourceSessionCount: Number(sessionRow?.count ?? 0)
		};
		const analysis = analyzeMigrationSnapshot(snapshot, storageChecks);
		return { snapshot, analysis, close: () => sqlite.close() };
	} catch (error) {
		sqlite.close();
		throw error;
	}
}

export function analyzeMigrationSnapshot(snapshot, storageChecks = []) {
	const userIds = snapshot.users.map((user) => user._id);
	const ownerIds = new Set(userIds);
	const publicIds = snapshot.tracks.map((track) => track.publicId);
	const storageKeys = snapshot.tracks.map((track) => track.storageKey);
	const categories = [];
	const counts = {
		duplicateUserIds: duplicateCount(userIds),
		duplicateUsernames: duplicateCount(snapshot.users.map((user) => user.username)),
		duplicateEmails: duplicateCount(snapshot.users.map((user) => user.email)),
		duplicateTrackIds: duplicateCount(snapshot.tracks.map((track) => track._id)),
		duplicatePublicIds: duplicateCount(publicIds),
		duplicateStorageKeys: duplicateCount(storageKeys),
		missingOwners: snapshot.tracks.filter((track) => !ownerIds.has(track.ownerId)).length,
		missingStorageReferences: storageChecks.filter((valid) => !valid).length,
		invalidUserIds: snapshot.users.filter((user) => !UUID_PATTERN.test(user._id)).length,
		invalidTrackIds: snapshot.tracks.filter((track) => !UUID_PATTERN.test(track._id)).length,
		invalidOwnerIds: snapshot.tracks.filter((track) => !UUID_PATTERN.test(track.ownerId)).length,
		invalidPublicIds: publicIds.filter(
			(value) => !Number.isSafeInteger(value) || value < 1
		).length,
		invalidTimestamps:
			snapshot.users.filter((user) => !user.createdAt || !user.updatedAt).length +
			snapshot.tracks.filter((track) => !track.createdAt || !track.updatedAt).length,
		invalidVisibility: snapshot.tracks.filter(
			(track) => !VISIBILITIES.has(track.visibility)
		).length,
		invalidStorageKeys: storageKeys.filter((key) => !STORAGE_KEY_PATTERN.test(key)).length,
		invalidNullableMetadata: snapshot.tracks.filter(
			(track) =>
				(track.bpm !== null &&
					(!Number.isInteger(track.bpm) || track.bpm < 20 || track.bpm > 300)) ||
				(track.durationMs !== null &&
					(!Number.isSafeInteger(track.durationMs) || track.durationMs < 0))
		).length
	};
	for (const [category, count] of Object.entries(counts)) {
		if (count > 0) categories.push(category);
	}
	const maxPublicId = publicIds.length ? Math.max(...publicIds) : 0;
	const publicCount = snapshot.tracks.filter(
		(track) => track.visibility === 'public'
	).length;
	return {
		userCount: snapshot.users.length,
		trackCount: snapshot.tracks.length,
		sessionCountExcluded: snapshot.sourceSessionCount,
		publicCount,
		privateCount: snapshot.tracks.length - publicCount,
		withBpmCount: snapshot.tracks.filter((track) => track.bpm !== null).length,
		withoutBpmCount: snapshot.tracks.filter((track) => track.bpm === null).length,
		minPublicId: publicIds.length ? Math.min(...publicIds) : 0,
		maxPublicId,
		counts,
		categories,
		valid: categories.length === 0,
		fingerprint: categories.length === 0 ? migrationFingerprint(snapshot) : null
	};
}

export async function inspectTransactionSupport(client) {
	const hello = await client
		.db('admin')
		.command({ hello: 1 }, { timeoutMS: MIGRATION_OPERATION_TIMEOUT_MS });
	return typeof hello.setName === 'string' || hello.msg === 'isdbgrid';
}

export async function inspectRequiredIndexes(collections) {
	const [userIndexes, trackIndexes] = await Promise.all([
		collections.users.indexes({ maxTimeMS: MIGRATION_OPERATION_TIMEOUT_MS }),
		collections.tracks.indexes({ maxTimeMS: MIGRATION_OPERATION_TIMEOUT_MS })
	]);
	const userNames = new Set(userIndexes.map(({ name }) => name));
	const trackNames = new Set(trackIndexes.map(({ name }) => name));
	const missing = [
		...MONGODB_INDEX_DEFINITIONS.users
			.map(({ name }) => name)
			.filter((name) => !userNames.has(name)),
		...MONGODB_INDEX_DEFINITIONS.tracks
			.map(({ name }) => name)
			.filter((name) => !trackNames.has(name))
	];
	return { compatible: missing.length === 0, missingCount: missing.length };
}

export async function inspectMigrationTarget(collections) {
	const [userCount, trackCount, sessionCount, marker, counter] = await Promise.all([
		collections.users.countDocuments({}, { timeoutMS: MIGRATION_OPERATION_TIMEOUT_MS }),
		collections.tracks.countDocuments({}, { timeoutMS: MIGRATION_OPERATION_TIMEOUT_MS }),
		collections.sessions.countDocuments({}, { timeoutMS: MIGRATION_OPERATION_TIMEOUT_MS }),
		collections.migrations.findOne(
			{ _id: SQLITE_MONGODB_MIGRATION_ID },
			{ projection: { _id: 1, version: 1, fingerprint: 1 }, timeoutMS: MIGRATION_OPERATION_TIMEOUT_MS }
		),
		collections.counters.findOne(
			{ _id: TRACK_PUBLIC_ID_COUNTER },
			{ projection: { _id: 0, value: 1 }, timeoutMS: MIGRATION_OPERATION_TIMEOUT_MS }
		)
	]);
	return {
		userCount,
		trackCount,
		sessionCount,
		hasMarker: marker !== null,
		markerVersion: marker?.version ?? null,
		markerFingerprint: marker?.fingerprint ?? null,
		counterValue: counter?.value ?? null,
		empty:
			userCount === 0 &&
			trackCount === 0 &&
			sessionCount === 0 &&
			marker === null &&
			counter === null
	};
}

export async function safeMongoAggregateFingerprint(collections) {
	const summaries = [];
	for (const name of ['users', 'sessions', 'tracks', 'counters', 'migrations']) {
		const [summary] = await collections[name]
			.aggregate(
				[
					{
						$group: {
							_id: null,
							count: { $sum: 1 },
							totalBytes: { $sum: { $bsonSize: '$$ROOT' } }
						}
					},
					{ $project: { _id: 0, count: 1, totalBytes: 1 } }
				],
				{ maxTimeMS: MIGRATION_OPERATION_TIMEOUT_MS }
			)
			.toArray();
		summaries.push({
			name,
			count: summary?.count ?? 0,
			totalBytes: summary?.totalBytes ?? 0
		});
	}
	return createHash('sha256')
		.update(JSON.stringify(summaries))
		.digest('hex');
}

async function targetSnapshot(collections, session) {
	const options = { timeoutMS: MIGRATION_OPERATION_TIMEOUT_MS, session };
	const [users, tracks] = await Promise.all([
		collections.users
			.find(
				{},
				{
					...options,
					projection: {
						_id: 1, username: 1, email: 1, passwordHash: 1,
						createdAt: 1, updatedAt: 1
					}
				}
			)
			.toArray(),
		collections.tracks
			.find(
				{},
				{
					...options,
					projection: {
						_id: 1, publicId: 1, ownerId: 1, title: 1, artist: 1,
						bpm: 1, musicalKey: 1, genre: 1, description: 1,
						originalFilename: 1, storageKey: 1, mimeType: 1,
						fileSizeBytes: 1, durationMs: 1, visibility: 1,
						createdAt: 1, updatedAt: 1
					}
				}
			)
			.toArray()
	]);
	return { users, tracks, sourceSessionCount: 0 };
}

export async function verifyMigration({ snapshot, analysis, collections, session }) {
	if (!analysis.valid) throw new MigrationValidationError(analysis.categories);
	const target = await targetSnapshot(collections, session);
	const [counter, marker] = await Promise.all([
		collections.counters.findOne(
			{ _id: TRACK_PUBLIC_ID_COUNTER },
			{ projection: { _id: 0, value: 1 }, timeoutMS: MIGRATION_OPERATION_TIMEOUT_MS, session }
		),
		collections.migrations.findOne(
			{ _id: SQLITE_MONGODB_MIGRATION_ID },
			{ projection: { _id: 0, version: 1, userCount: 1, trackCount: 1, maxPublicId: 1, fingerprint: 1 }, timeoutMS: MIGRATION_OPERATION_TIMEOUT_MS, session }
		)
	]);
	const targetFingerprint = migrationFingerprint(target);
	const checks = {
		userCount: target.users.length === analysis.userCount,
		trackCount: target.tracks.length === analysis.trackCount,
		records: targetFingerprint === analysis.fingerprint,
		counter:
			Number.isSafeInteger(counter?.value) &&
			counter.value >= analysis.maxPublicId,
		marker:
			marker?.version === MIGRATION_VERSION &&
			marker.userCount === analysis.userCount &&
			marker.trackCount === analysis.trackCount &&
			marker.maxPublicId === analysis.maxPublicId &&
			marker.fingerprint === analysis.fingerprint
	};
	return {
		ok: Object.values(checks).every(Boolean),
		checks,
		sourceFingerprint: analysis.fingerprint,
		targetFingerprint
	};
}

export async function dryRunMigration({ snapshot, analysis, collections, client }) {
	const targetFingerprintBefore = await safeMongoAggregateFingerprint(collections);
	const [indexes, target, transactionSupported] = await Promise.all([
		inspectRequiredIndexes(collections),
		inspectMigrationTarget(collections),
		inspectTransactionSupport(client)
	]);
	let targetCompatible = target.empty;
	if (target.hasMarker && target.markerFingerprint === analysis.fingerprint) {
		const verification = await verifyMigration({ snapshot, analysis, collections });
		targetCompatible = verification.ok;
	}
	const targetFingerprintAfter = await safeMongoAggregateFingerprint(collections);
	return {
		analysis,
		indexes,
		target: {
			empty: target.empty,
			compatible: targetCompatible,
			userCount: target.userCount,
			trackCount: target.trackCount,
			sessionCount: target.sessionCount,
			counterCompatible:
				target.counterValue === null ||
				target.counterValue >= analysis.maxPublicId
		},
		transactionSupported,
		targetUnchanged: targetFingerprintBefore === targetFingerprintAfter,
		canApply:
			analysis.valid &&
			indexes.compatible &&
			transactionSupported &&
			targetCompatible
	};
}

export async function applyMigration({
	snapshot,
	analysis,
	collections,
	client,
	confirmation,
	failureStep
}) {
	if (confirmation !== MIGRATION_CONFIRMATION) {
		throw new Error('Apply mode requires the explicit migration confirmation flag.');
	}
	if (!analysis.valid) throw new MigrationValidationError(analysis.categories);
	const [transactionSupported, indexes, target] = await Promise.all([
		inspectTransactionSupport(client),
		inspectRequiredIndexes(collections),
		inspectMigrationTarget(collections)
	]);
	if (!transactionSupported) {
		throw new Error('MongoDB migration apply requires transaction support.');
	}
	if (!indexes.compatible) throw new Error('Required MongoDB indexes are missing.');
	if (!target.empty) {
		if (
			target.hasMarker &&
			target.markerVersion === MIGRATION_VERSION &&
			target.markerFingerprint === analysis.fingerprint
		) {
			const verification = await verifyMigration({ snapshot, analysis, collections });
			if (verification.ok) return { applied: false, rerun: true, verification };
		}
		throw new Error('Target MongoDB database is non-empty or incompatible.');
	}
	const mongoSession = client.startSession();
	try {
		await mongoSession.withTransaction(
			async () => {
				if (snapshot.users.length) {
					await collections.users.insertMany(snapshot.users, {
						session: mongoSession,
						timeoutMS: MIGRATION_OPERATION_TIMEOUT_MS,
						ordered: true
					});
				}
				if (failureStep === 'after-users') throw new Error('Synthetic migration failure.');
				if (snapshot.tracks.length) {
					await collections.tracks.insertMany(snapshot.tracks, {
						session: mongoSession,
						timeoutMS: MIGRATION_OPERATION_TIMEOUT_MS,
						ordered: true
					});
				}
				if (failureStep === 'after-tracks') throw new Error('Synthetic migration failure.');
				await collections.counters.findOneAndUpdate(
					{ _id: TRACK_PUBLIC_ID_COUNTER },
					{ $max: { value: analysis.maxPublicId } },
					{
						session: mongoSession,
						timeoutMS: MIGRATION_OPERATION_TIMEOUT_MS,
						upsert: true,
						returnDocument: 'after'
					}
				);
				if (failureStep === 'after-counter') throw new Error('Synthetic migration failure.');
				await collections.migrations.insertOne(
					{
						_id: SQLITE_MONGODB_MIGRATION_ID,
						version: MIGRATION_VERSION,
						userCount: analysis.userCount,
						trackCount: analysis.trackCount,
						maxPublicId: analysis.maxPublicId,
						fingerprint: analysis.fingerprint,
						completedAt: new Date()
					},
					{ session: mongoSession, timeoutMS: MIGRATION_OPERATION_TIMEOUT_MS }
				);
				const verification = await verifyMigration({
					snapshot,
					analysis,
					collections,
					session: mongoSession
				});
				if (!verification.ok) throw new Error('Migration verification failed before commit.');
			},
			{
				maxCommitTimeMS: MIGRATION_OPERATION_TIMEOUT_MS,
				readPreference: 'primary',
				readConcern: { level: 'snapshot' },
				writeConcern: { w: 'majority' }
			}
		);
	} finally {
		await mongoSession.endSession();
	}
	const verification = await verifyMigration({ snapshot, analysis, collections });
	return { applied: true, rerun: false, verification };
}
