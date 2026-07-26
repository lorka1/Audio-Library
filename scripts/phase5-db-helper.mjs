import { readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

function normalizeRows(rows) {
	return rows.map((row) =>
		Object.fromEntries(
			Object.entries(row).map(([key, value]) => [
				key,
				typeof value === 'bigint' ? value.toString() : value
			])
		)
	);
}

function captureDatabaseState(database, exclusions = {}) {
	const excludedUserIds = new Set(
		(exclusions.userIds ?? []).map((value) => String(value))
	);
	const excludedTrackIds = new Set(
		(exclusions.trackIds ?? []).map((value) => String(value))
	);

	return {
		users: normalizeRows(
			database.prepare('select * from users order by id').all()
		).filter((row) => !excludedUserIds.has(String(row.id))),
		sessions: normalizeRows(
			database.prepare('select * from sessions order by id').all()
		).filter((row) => !excludedUserIds.has(String(row.user_id))),
		tracks: normalizeRows(
			database.prepare('select * from tracks order by id').all()
		).filter((row) => !excludedTrackIds.has(String(row.id)))
	};
}

function seedDatabase(database, request) {
	const quickCheck = database.prepare('pragma quick_check').get();

	if (quickCheck?.quick_check !== 'ok') {
		throw new Error('Temporary database quick_check failed.');
	}

	const databaseStateBefore = captureDatabaseState(database);

	const insertUser = database.prepare(
		'insert into users (id, email, username, password_hash, created_at, updated_at) values (?, ?, ?, ?, ?, ?)'
	);
	const insertTrack = database.prepare(
		`insert into tracks (
			id,
			owner_id,
			title,
			artist,
			bpm,
			musical_key,
			genre,
			description,
			original_filename,
			storage_key,
			mime_type,
			file_size_bytes,
			duration_ms,
			visibility,
			created_at,
			updated_at
		) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	);

	database.exec('begin immediate');

	try {
		insertUser.run(
			request.user.id,
			request.user.email,
			request.user.username,
			request.user.passwordHash,
			request.user.createdAt,
			request.user.updatedAt
		);

		for (const track of request.tracks) {
			insertTrack.run(
				track.internalId,
				request.user.id,
				track.title,
				track.artist,
				track.bpm,
				track.musicalKey,
				track.genre,
				track.description,
				track.originalFilename,
				track.storedFilename,
				track.mimeType,
				track.fileSizeBytes,
				null,
				track.visibility,
				track.createdAt,
				track.createdAt
			);
		}

		database.exec('commit');
	} catch (error) {
		database.exec('rollback');
		throw error;
	}

	const selectPublicId = database.prepare(
		'select public_id from tracks where id = ?'
	);
	const publicIds = request.tracks.map((track) => {
		const row = selectPublicId.get(track.internalId);
		return {
			internalId: track.internalId,
			publicId: Number(row?.public_id)
		};
	});
	const trackSecrets = database
		.prepare('select id, owner_id, storage_key from tracks')
		.all()
		.flatMap((row) => [row.id, row.owner_id, row.storage_key]);
	const userSecrets = database
		.prepare('select id, email from users')
		.all()
		.flatMap((row) => [row.id, row.email]);

	return {
		databaseStateBefore,
		publicIds,
		internalSecrets: [...trackSecrets, ...userSecrets]
	};
}

const [, , requestPath, responsePath] = process.argv;

if (!requestPath || !responsePath) {
	throw new Error('Database helper request and response paths are required.');
}

const request = JSON.parse(readFileSync(requestPath, 'utf8'));
const database = new DatabaseSync(request.databasePath);

try {
	const response =
		request.action === 'seed'
			? seedDatabase(database, request)
			: request.action === 'capture-database-state'
				? {
						databaseState: captureDatabaseState(
							database,
							request.exclusions
						)
					}
				: (() => {
						throw new Error('Unsupported database helper action.');
					})();

	writeFileSync(responsePath, JSON.stringify(response), {
		encoding: 'utf8',
		flag: 'wx'
	});
} finally {
	database.close();
}
