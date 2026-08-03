import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import {
	access,
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	unlink,
	writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { MongoClientManager } from '../src/lib/server/mongodb/client.ts';
import {
	assertMongoTestDatabaseName,
	readMongoConfig
} from '../src/lib/server/mongodb/config.ts';
import { getMongoCollections } from '../src/lib/server/mongodb/collections.ts';
import { MONGODB_INDEX_DEFINITIONS } from '../src/lib/server/mongodb/indexes.ts';
import {
	createMongoTrackRepository,
	initializeMongoPublicTrackIdCounter
} from '../src/lib/server/tracks/mongodb-repository.ts';
import { DuplicateTrackError } from '../src/lib/server/tracks/contract.ts';

const OPERATION_TIMEOUT_MS = 5_000;
const TOTAL_TIMEOUT_MS = 120_000;
const EXPECTED_CHECKS = 31;
let checkNumber = 0;
let activeStep = 'setup';

async function check(label, assertion) {
	await assertion();
	console.log(`[check ${++checkNumber}/${EXPECTED_CHECKS}] ${label}`);
}

function ownedDatabaseName(base) {
	const suffix = `_m4_tracks_${randomBytes(6).toString('hex')}`;
	const name = `${base.slice(0, 63 - suffix.length)}${suffix}`;
	assertMongoTestDatabaseName(name, process.env.MONGODB_DB_NAME ?? '');
	return name;
}

function safeError(error) {
	if (
		error instanceof Error &&
		error.message.startsWith('MongoDB tracks integration requires')
	) {
		return error.message;
	}
	return `MongoDB tracks integration failed during ${activeStep}.`;
}

function syntheticTrack(ownerId, overrides = {}) {
	const now = new Date('2026-07-27T12:00:00.000Z');
	return {
		id: randomUUID(),
		ownerId,
		title: 'Synthetic track',
		artist: 'Synthetic artist',
		bpm: 124,
		musicalKey: 'C minor',
		genre: 'Techno',
		description: 'Synthetic M4 metadata.',
		originalFilename: 'synthetic.mp3',
		storageKey: `${randomUUID()}.mp3`,
		mimeType: 'audio/mpeg',
		fileSizeBytes: 4,
		createdAt: now,
		updatedAt: now,
		...overrides
	};
}

async function exists(path) {
	return access(path).then(
		() => true,
		() => false
	);
}

async function deleteWithQuarantine(repository, publicId, ownerId, audioRoot, failDelete = false) {
	const storage = await repository.getOwnerTrackStorage(publicId, ownerId);
	if (!storage) return 'missing';
	const originalPath = join(audioRoot, storage.storedFilename);
	const quarantinePath = join(audioRoot, `.delete-${randomUUID()}.tmp`);
	let quarantined = false;
	try {
		await rename(originalPath, quarantinePath);
		quarantined = true;
	} catch (error) {
		if (error?.code !== 'ENOENT') throw error;
	}
	try {
		if (failDelete) throw new Error('Synthetic database deletion failure.');
		const deleted = await repository.deleteOwnerTrack(publicId, ownerId);
		if (!deleted) {
			if (quarantined) await rename(quarantinePath, originalPath);
			return 'missing';
		}
	} catch (error) {
		if (quarantined) await rename(quarantinePath, originalPath);
		throw error;
	}
	if (quarantined) await unlink(quarantinePath);
	return quarantined ? 'deleted' : 'deleted-missing-file';
}

async function main() {
	const config = readMongoConfig(process.env);
	assertMongoTestDatabaseName(config.testDatabaseName, config.databaseName);
	const databaseName = ownedDatabaseName(config.testDatabaseName);
	assert.notEqual(databaseName, config.databaseName);
	const manager = new MongoClientManager({
		...config,
		testDatabaseName: databaseName
	});
	const abortController = new AbortController();
	const watchdog = setTimeout(
		() => abortController.abort(new Error('MongoDB tracks integration timed out.')),
		TOTAL_TIMEOUT_MS
	);
	watchdog.unref();
	let database;
	let audioRoot;
	let client;
	let activeClientSessions = 0;
	let primaryFailure;
	let cleanupFailure;
	let developmentCountsBefore;

	try {
		activeStep = 'isolated setup';
		client = await manager.connect();
		database = client.db(databaseName);
		const development = client.db(config.databaseName);
		const developmentCollectionNames = (
			await development
				.listCollections({}, { nameOnly: true, timeoutMS: OPERATION_TIMEOUT_MS })
				.toArray()
		).map(({ name }) => name);
		developmentCountsBefore = new Map(
			await Promise.all(
				developmentCollectionNames.map(async (name) => [
					name,
					await development
						.collection(name)
						.estimatedDocumentCount({ timeoutMS: OPERATION_TIMEOUT_MS })
				])
			)
		);
		audioRoot = await mkdtemp(join(tmpdir(), 'audio-library-m4-'));
		assert.equal(basename(audioRoot).startsWith('audio-library-m4-'), true);

		const collections = getMongoCollections(database);
		await Promise.all([
			collections.users.createIndexes(
				[...MONGODB_INDEX_DEFINITIONS.users],
				{ maxTimeMS: OPERATION_TIMEOUT_MS }
			),
			collections.tracks.createIndexes(
				[...MONGODB_INDEX_DEFINITIONS.tracks],
				{ maxTimeMS: OPERATION_TIMEOUT_MS }
			)
		]);
		const repository = createMongoTrackRepository(
			collections.tracks,
			collections.counters,
			collections.users,
			{ timeoutMS: OPERATION_TIMEOUT_MS, signal: abortController.signal }
		);
		const ownerId = randomUUID();
		const otherOwnerId = randomUUID();
		const now = new Date('2026-07-27T12:00:00.000Z');
		await collections.users.insertMany(
			[
				{
					_id: ownerId,
					username: 'm4_owner',
					email: 'm4.owner@example.test',
					passwordHash: 'synthetic-hash',
					createdAt: now,
					updatedAt: now
				},
				{
					_id: otherOwnerId,
					username: 'm4_other',
					email: 'm4.other@example.test',
					passwordHash: 'synthetic-hash',
					createdAt: now,
					updatedAt: now
				}
			],
			{ timeoutMS: OPERATION_TIMEOUT_MS, signal: abortController.signal }
		);

		await check('explicit counter initialization and atomic allocation', async () => {
			assert.equal(
				await initializeMongoPublicTrackIdCounter(
					collections.counters,
					40,
					{ timeoutMS: OPERATION_TIMEOUT_MS }
				),
				40
			);
			assert.equal(await repository.allocatePublicTrackId(), 41);
		});

		await check('concurrent public ID allocation remains unique and positive', async () => {
			const ids = await Promise.all(
				Array.from({ length: 20 }, () => repository.allocatePublicTrackId())
			);
			assert.equal(new Set(ids).size, ids.length);
			assert.equal(ids.every((id) => Number.isSafeInteger(id) && id > 0), true);
		});

		const originalCoverImage = {
			storageKey: `${randomUUID()}.png`,
			mimeType: 'image/png',
			byteSize: 68
		};
		const publicInput = syntheticTrack(ownerId, {
			coverImage: originalCoverImage
		});
		const created = await repository.createTrack(publicInput);
		await check('track creation preserves the numeric public URL identity', () => {
			assert.equal(created.title, publicInput.title);
			assert.equal(Number.isSafeInteger(created.id), true);
		});

		await check('public lookup returns a safe domain model', async () => {
			const track = await repository.findPublicTrackByPublicId(created.id);
			assert.equal(track?.id, created.id);
			assert.equal(track?.coverImageUrl, `/api/tracks/${created.id}/cover`);
		});

		const privateCoverImage = {
			storageKey: `${randomUUID()}.webp`,
			mimeType: 'image/webp',
			byteSize: 42
		};
		const privateTrack = await repository.createTrack(
			syntheticTrack(ownerId, { coverImage: privateCoverImage }),
			{ visibility: 'private' }
		);
		await check('private tracks are excluded from public reads', async () => {
			assert.equal(await repository.findPublicTrackByPublicId(privateTrack.id), null);
			assert.equal(
				(await repository.listPublicTracks({ sort: 'newest' })).some(
					({ id }) => id === privateTrack.id
				),
				false
			);
		});

		await check('owner listing includes only authenticated owner tracks', async () => {
			const tracks = await repository.listTracksForOwner(ownerId);
			assert.equal(tracks.length, 2);
			assert.equal((await repository.listTracksForOwner(otherOwnerId)).length, 0);
		});

		await check('public projection contains only browser-safe fields', async () => {
			const track = await repository.findPublicTrackByPublicId(created.id);
			assert.deepEqual(Object.keys(track ?? {}).sort(), [
				'artist', 'bpm', 'coverImageUrl', 'createdAt', 'description', 'fileSizeBytes', 'genre',
				'id', 'musicalKey', 'ownerUsername', 'title', 'updatedAt'
			]);
			assert.equal(JSON.stringify(track).includes(originalCoverImage.storageKey), false);
		});

		await check('owner projection contains only owner-safe fields', async () => {
			const track = await repository.findOwnerTrack(created.id, ownerId);
			assert.deepEqual(Object.keys(track ?? {}).sort(), [
				'artist', 'bpm', 'coverImageUrl', 'createdAt', 'description', 'fileSizeBytes', 'genre',
				'mimeType', 'musicalKey', 'originalFilename', 'publicId', 'title',
				'updatedAt', 'visibility'
			]);
			assert.equal(JSON.stringify(track).includes(originalCoverImage.storageKey), false);
		});

		await check('storage lookup remains server-only and owner-scoped', async () => {
			const storage = await repository.getOwnerTrackStorage(created.id, ownerId);
			assert.equal(storage?.storedFilename, publicInput.storageKey);
			assert.deepEqual(storage?.coverImage, originalCoverImage);
			assert.equal(
				await repository.getOwnerTrackStorage(created.id, otherOwnerId),
				null
			);
		});

		await check('cover delivery is public or exact-owner scoped', async () => {
			assert.deepEqual(
				await repository.findTrackCoverForAccess(created.id),
				{ publicId: created.id, ...originalCoverImage }
			);
			assert.equal(
				await repository.findTrackCoverForAccess(privateTrack.id),
				null
			);
			assert.equal(
				await repository.findTrackCoverForAccess(
					privateTrack.id,
					otherOwnerId
				),
				null
			);
			assert.deepEqual(
				await repository.findTrackCoverForAccess(privateTrack.id, ownerId),
				{ publicId: privateTrack.id, ...privateCoverImage }
			);
		});

		await check('owner metadata edit changes only mutable metadata', async () => {
			const updated = await repository.updateOwnerTrackMetadata(created.id, ownerId, {
				title: 'Updated synthetic track',
				artist: 'Updated synthetic artist',
				bpm: 128,
				musicalKey: 'D minor',
				genre: 'House',
				description: null,
				updatedAt: new Date('2026-07-27T13:00:00.000Z')
			});
			assert.equal(updated?.bpm, 128);
			assert.equal(
				(await repository.getOwnerTrackStorage(created.id, ownerId))?.storedFilename,
				publicInput.storageKey
			);
			assert.deepEqual(
				(await repository.getOwnerTrackStorage(created.id, ownerId))?.coverImage,
				originalCoverImage
			);
		});

		const replacementCoverImage = {
			storageKey: `${randomUUID()}.jpg`,
			mimeType: 'image/jpeg',
			byteSize: 73
		};
		await check('owner can replace cover metadata without exposing its storage key', async () => {
			const updated = await repository.updateOwnerTrackMetadata(created.id, ownerId, {
				title: 'Updated synthetic track',
				artist: 'Updated synthetic artist',
				bpm: 128,
				musicalKey: 'D minor',
				genre: 'House',
				description: null,
				coverImage: replacementCoverImage,
				updatedAt: new Date('2026-07-27T14:00:00.000Z')
			});
			assert.equal(updated?.coverImageUrl, `/api/tracks/${created.id}/cover`);
			assert.equal(JSON.stringify(updated).includes(replacementCoverImage.storageKey), false);
			assert.deepEqual(
				(await repository.getOwnerTrackStorage(created.id, ownerId))?.coverImage,
				replacementCoverImage
			);
		});

		await check('non-owner metadata edit is rejected safely', async () => {
			assert.equal(
				await repository.updateOwnerTrackMetadata(created.id, otherOwnerId, {
					title: 'Forged',
					artist: 'Forged',
					bpm: null,
					musicalKey: null,
					genre: null,
					description: null,
					coverImage: null,
					updatedAt: new Date()
				}),
				null
			);
			assert.deepEqual(
				(await repository.getOwnerTrackStorage(created.id, ownerId))?.coverImage,
				replacementCoverImage
			);
		});

		await check('owner can remove cover metadata while retaining the audio file', async () => {
			const updated = await repository.updateOwnerTrackMetadata(created.id, ownerId, {
				title: 'Updated synthetic track',
				artist: 'Updated synthetic artist',
				bpm: 128,
				musicalKey: 'D minor',
				genre: 'House',
				description: null,
				coverImage: null,
				updatedAt: new Date('2026-07-27T15:00:00.000Z')
			});
			assert.equal(updated?.coverImageUrl, null);
			const storage = await repository.getOwnerTrackStorage(created.id, ownerId);
			assert.equal(storage?.storedFilename, publicInput.storageKey);
			assert.equal(storage?.coverImage, null);
			assert.equal(await repository.findTrackCoverForAccess(created.id), null);
		});

		const explicitNullCover = await repository.createTrack(
			syntheticTrack(ownerId, { coverImage: null })
		);
		const legacyCover = await repository.createTrack(syntheticTrack(ownerId));
		await collections.tracks.updateOne(
			{ publicId: legacyCover.id },
			{ $unset: { coverImage: '' } },
			{ timeoutMS: OPERATION_TIMEOUT_MS, signal: abortController.signal }
		);
		await check('legacy and explicit-null cover documents remain compatible', async () => {
			assert.equal(
				(await repository.findPublicTrackByPublicId(explicitNullCover.id))
					?.coverImageUrl,
				null
			);
			assert.equal(
				(await repository.findPublicTrackByPublicId(legacyCover.id))?.coverImageUrl,
				null
			);
			assert.equal(
				await repository.findTrackCoverForAccess(legacyCover.id, ownerId),
				null
			);
		});

		await check('streaming lookup requires public visibility', async () => {
			assert.equal((await repository.findTrackForStreaming(created.id))?.visibility, 'public');
			assert.equal(await repository.findTrackForStreaming(privateTrack.id), null);
		});

		await check('download lookup preserves the original download filename', async () => {
			assert.equal(
				(await repository.findTrackForDownload(created.id))?.originalFilename,
				publicInput.originalFilename
			);
		});

		await check('non-owner deletion is rejected', async () => {
			assert.equal(await repository.deleteOwnerTrack(created.id, otherOwnerId), false);
			assert.notEqual(await repository.findOwnerTrack(created.id, ownerId), null);
		});

		await check('missing track behavior returns safe null or false results', async () => {
			const missingId = 9_999_999;
			assert.equal(await repository.findPublicTrackByPublicId(missingId), null);
			assert.equal(await repository.findOwnerTrack(missingId, ownerId), null);
			assert.equal(await repository.deleteOwnerTrack(missingId, ownerId), false);
		});

		await check('duplicate public IDs map to a domain error', async () => {
			await assert.rejects(
				repository.createTrack(syntheticTrack(ownerId), { publicId: created.id }),
				(error) => error instanceof DuplicateTrackError && error.field === 'publicId'
			);
		});

		await check('duplicate storage keys map to a domain error', async () => {
			await assert.rejects(
				repository.createTrack(
					syntheticTrack(ownerId, { storageKey: publicInput.storageKey })
				),
				(error) => error instanceof DuplicateTrackError && error.field === 'storageKey'
			);
		});

		const sentinelPath = join(audioRoot, 'pre-existing.keep');
		await writeFile(sentinelPath, 'preserve', { flag: 'wx', mode: 0o600 });
		await check('insertion failure removes only the newly written audio file', async () => {
			const newFilename = `${randomUUID()}.mp3`;
			const newPath = join(audioRoot, newFilename);
			await writeFile(newPath, Buffer.from([1, 2, 3, 4]), { flag: 'wx', mode: 0o600 });
			try {
				await repository.createTrack(
					syntheticTrack(ownerId, {
						storageKey: newFilename,
						originalFilename: 'failed.mp3'
					}),
					{ publicId: created.id }
				);
				assert.fail('Synthetic duplicate insert should fail.');
			} catch {
				await unlink(newPath);
			}
			assert.equal(await exists(newPath), false);
			assert.equal((await readFile(sentinelPath, 'utf8')), 'preserve');
		});

		const quarantineInput = syntheticTrack(ownerId);
		const quarantineTrack = await repository.createTrack(quarantineInput);
		await writeFile(join(audioRoot, quarantineInput.storageKey), Buffer.from([1, 2, 3, 4]));
		await check('quarantine deletion succeeds and removes metadata and audio', async () => {
			assert.equal(
				await deleteWithQuarantine(repository, quarantineTrack.id, ownerId, audioRoot),
				'deleted'
			);
			assert.equal(await repository.findOwnerTrack(quarantineTrack.id, ownerId), null);
			assert.equal(await exists(join(audioRoot, quarantineInput.storageKey)), false);
		});

		const rollbackInput = syntheticTrack(ownerId);
		const rollbackTrack = await repository.createTrack(rollbackInput);
		await writeFile(join(audioRoot, rollbackInput.storageKey), Buffer.from([1, 2, 3, 4]));
		await check('database deletion failure restores quarantined audio', async () => {
			await assert.rejects(
				deleteWithQuarantine(repository, rollbackTrack.id, ownerId, audioRoot, true)
			);
			assert.equal(await exists(join(audioRoot, rollbackInput.storageKey)), true);
			assert.notEqual(await repository.findOwnerTrack(rollbackTrack.id, ownerId), null);
		});

		const missingFileTrack = await repository.createTrack(syntheticTrack(ownerId));
		await check('missing audio file deletion still removes metadata safely', async () => {
			assert.equal(
				await deleteWithQuarantine(repository, missingFileTrack.id, ownerId, audioRoot),
				'deleted-missing-file'
			);
			assert.equal(await repository.findOwnerTrack(missingFileTrack.id, ownerId), null);
		});

		const directDelete = await repository.createTrack(syntheticTrack(ownerId));
		await check('owner deletion requires both public ID and owner ID', async () => {
			assert.equal(await repository.deleteOwnerTrack(directDelete.id, ownerId), true);
			assert.equal(await repository.findOwnerTrack(directDelete.id, ownerId), null);
		});

		await check('counter allocations are never reused after failed inserts', async () => {
			const next = await repository.allocatePublicTrackId();
			assert.equal(next > directDelete.id, true);
		});

		await check('development MongoDB document counts remain unchanged', async () => {
			for (const [name, count] of developmentCountsBefore) {
				assert.equal(
					await development
						.collection(name)
						.estimatedDocumentCount({ timeoutMS: OPERATION_TIMEOUT_MS }),
					count
				);
			}
		});

		const clientSession = client.startSession();
		activeClientSessions += 1;
		await clientSession.endSession();
		activeClientSessions -= 1;
	} catch (error) {
		primaryFailure = error;
	} finally {
		if (database) {
			try {
				activeStep = 'exact test database cleanup';
				await database.dropDatabase({ timeoutMS: OPERATION_TIMEOUT_MS });
				await check('exact test database cleanup', () => undefined);
			} catch (error) {
				cleanupFailure = error;
			}
		}
		if (audioRoot) {
			try {
				activeStep = 'exact temporary audio cleanup';
				assert.equal(basename(audioRoot).startsWith('audio-library-m4-'), true);
				await rm(audioRoot, { recursive: true });
				await check('exact temporary audio cleanup', async () =>
					assert.equal(await exists(audioRoot), false)
				);
			} catch (error) {
				cleanupFailure ??= error;
			}
		}
		try {
			activeStep = 'MongoClient and ClientSession cleanup';
			await manager.close(true);
			if (!primaryFailure) {
				await check('owned MongoClient and ClientSession cleanup', () =>
					assert.equal(activeClientSessions, 0)
				);
			}
		} catch (error) {
			cleanupFailure ??= error;
		}
		clearTimeout(watchdog);
	}

	if (primaryFailure) throw primaryFailure;
	if (cleanupFailure) throw cleanupFailure;
	assert.equal(checkNumber, EXPECTED_CHECKS);
	console.log(`MongoDB tracks integration passed ${checkNumber}/${EXPECTED_CHECKS}.`);
}

main().catch((error) => {
	console.error(safeError(error));
	process.exitCode = 1;
});
