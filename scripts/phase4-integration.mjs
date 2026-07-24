import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
	appendFileSync,
	existsSync
} from 'node:fs';
import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	stat,
	writeFile
} from 'node:fs/promises';
import { createServer, connect } from 'node:net';
import { tmpdir } from 'node:os';
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep
} from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client';
import { config as loadEnvironment } from 'dotenv';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMP_PREFIX = 'audio-library-phase4-integration-';
const STARTUP_TIMEOUT_MS = 60_000;
const OVERALL_TIMEOUT_MS = 180_000;
const REQUEST_TIMEOUT_MS = 10_000;
const SHUTDOWN_TIMEOUT_MS = 8_000;
const LOG_TAIL_LIMIT = 64 * 1024;

loadEnvironment({ path: join(PROJECT_ROOT, '.env'), quiet: true });

let child;
let childExitPromise;
let temporaryRoot;
let temporaryClient;
let testPort;
let stdoutPath;
let stderrPath;
let stdoutTail = '';
let stderrTail = '';
let startupComplete = false;
let realStateForCleanup;

const overallController = new AbortController();

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

function updateTail(current, chunk) {
	const updated = `${current}${chunk}`;
	return updated.length <= LOG_TAIL_LIMIT
		? updated
		: updated.slice(updated.length - LOG_TAIL_LIMIT);
}

function printServerLogs() {
	console.error('--- vite.out.log ---');
	console.error(stdoutTail || '<empty>');
	console.error('--- vite.err.log ---');
	console.error(stderrTail || '<empty>');
}

function resolveConfiguredPath(value, fallback) {
	const configured = value?.trim() || fallback;
	return isAbsolute(configured)
		? resolve(configured)
		: resolve(PROJECT_ROOT, configured);
}

function isSafeTemporaryRoot(path) {
	const resolvedParent = resolve(tmpdir());
	const resolvedPath = resolve(path);

	return (
		dirname(resolvedPath) === resolvedParent &&
		basename(resolvedPath).startsWith(TEMP_PREFIX)
	);
}

async function hashFile(path) {
	const contents = await readFile(path);
	return createHash('sha256').update(contents).digest('hex');
}

async function optionalFileSnapshot(path) {
	try {
		const fileStat = await stat(path);

		if (!fileStat.isFile()) {
			return null;
		}

		return {
			size: fileStat.size,
			hash: await hashFile(path)
		};
	} catch (error) {
		if (error && error.code === 'ENOENT') {
			return null;
		}

		throw error;
	}
}

async function directorySnapshot(root) {
	const snapshot = {};

	async function visit(directory, prefix = '') {
		let entries;

		try {
			entries = await readdir(directory, { withFileTypes: true });
		} catch (error) {
			if (error && error.code === 'ENOENT') {
				return;
			}

			throw error;
		}

		for (const entry of entries.sort((left, right) =>
			left.name.localeCompare(right.name)
		)) {
			const relativeName = prefix ? `${prefix}/${entry.name}` : entry.name;
			const absolutePath = join(directory, entry.name);

			if (entry.isDirectory()) {
				await visit(absolutePath, relativeName);
			} else if (entry.isFile()) {
				snapshot[relativeName] = await optionalFileSnapshot(absolutePath);
			}
		}
	}

	await visit(root);
	return snapshot;
}

async function realStateSnapshot(realDatabase, realAudioRoot) {
	return {
		database: await optionalFileSnapshot(realDatabase),
		databaseWal: await optionalFileSnapshot(`${realDatabase}-wal`),
		databaseShm: await optionalFileSnapshot(`${realDatabase}-shm`),
		audio: await directorySnapshot(realAudioRoot)
	};
}

function snapshotsEqual(left, right) {
	return JSON.stringify(left) === JSON.stringify(right);
}

async function copyDatabaseSnapshot(realDatabase, temporaryDatabase) {
	const before = await Promise.all([
		optionalFileSnapshot(realDatabase),
		optionalFileSnapshot(`${realDatabase}-wal`)
	]);

	assert(before[0] !== null, 'The real development database does not exist.');
	await copyFile(realDatabase, temporaryDatabase);

	if (before[1]) {
		await copyFile(`${realDatabase}-wal`, `${temporaryDatabase}-wal`);
	}

	const after = await Promise.all([
		optionalFileSnapshot(realDatabase),
		optionalFileSnapshot(`${realDatabase}-wal`)
	]);

	assert(
		snapshotsEqual(before, after),
		'The real database changed while its temporary snapshot was being copied.'
	);
}

async function reservePort() {
	return new Promise((resolvePort, reject) => {
		const server = createServer();

		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();

			if (!address || typeof address === 'string') {
				server.close();
				reject(new Error('Unable to reserve an isolated integration port.'));
				return;
			}

			const port = address.port;
			server.close((error) => {
				if (error) {
					reject(error);
				} else {
					resolvePort(port);
				}
			});
		});
	});
}

function requestSignal() {
	return AbortSignal.any([
		overallController.signal,
		AbortSignal.timeout(REQUEST_TIMEOUT_MS)
	]);
}

async function request(baseUrl, path, options = {}) {
	return fetch(`${baseUrl}${path}`, {
		redirect: 'manual',
		...options,
		signal: requestSignal()
	});
}

function delay(milliseconds) {
	return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function waitForStartup(baseUrl) {
	const startedAt = Date.now();
	let lastProgressSecond = -1;

	while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
		if (overallController.signal.aborted) {
			throw overallController.signal.reason;
		}

		if (child?.exitCode !== null) {
			throw new Error(`Vite exited during startup with code ${child?.exitCode}.`);
		}

		const elapsedSecond = Math.floor((Date.now() - startedAt) / 1000);

		if (
			elapsedSecond !== lastProgressSecond &&
			elapsedSecond % 2 === 0
		) {
			console.log(
				`[startup] waiting for Vite on port ${testPort} (${elapsedSecond}s)`
			);
			lastProgressSecond = elapsedSecond;
		}

		try {
			const response = await request(baseUrl, '/tracks');

			if (response.status === 200) {
				await response.text();
				startupComplete = true;
				console.log(
					`[startup] Vite is ready after ${((Date.now() - startedAt) / 1000).toFixed(1)}s`
				);
				return;
			}
		} catch (error) {
			if (overallController.signal.aborted) {
				throw error;
			}
		}

		await delay(400);
	}

	throw new Error('Vite did not become ready within 60 seconds.');
}

async function canConnect(port) {
	return new Promise((resolveConnection) => {
		const socket = connect({ host: '127.0.0.1', port });
		const finish = (connected) => {
			socket.destroy();
			resolveConnection(connected);
		};

		socket.setTimeout(750, () => finish(false));
		socket.once('connect', () => finish(true));
		socket.once('error', () => finish(false));
	});
}

function isProcessAlive(pid) {
	if (!pid) {
		return false;
	}

	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function stopChildProcess() {
	if (!child?.pid || child.exitCode !== null) {
		return;
	}

	if (process.platform === 'win32') {
		spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
			stdio: 'ignore',
			windowsHide: true
		});
	} else {
		try {
			process.kill(-child.pid, 'SIGTERM');
		} catch {
			child.kill('SIGTERM');
		}
	}

	await Promise.race([childExitPromise, delay(SHUTDOWN_TIMEOUT_MS)]);

	if (child.exitCode === null) {
		if (process.platform === 'win32') {
			spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
				stdio: 'ignore',
				windowsHide: true
			});
		} else {
			try {
				process.kill(-child.pid, 'SIGKILL');
			} catch {
				child.kill('SIGKILL');
			}
		}

		await Promise.race([childExitPromise, delay(SHUTDOWN_TIMEOUT_MS)]);
	}
}

function recordHeaders(response) {
	return [...response.headers.entries()]
		.map(([name, value]) => `${name}: ${value}`)
		.join('\n');
}

function assertBytes(actual, expected, context) {
	assert(
		Buffer.from(actual).equals(Buffer.from(expected)),
		`${context} bytes did not match the expected file bytes.`
	);
}

function assertNoSecrets(text, secrets, context) {
	for (const secret of secrets) {
		if (!secret) {
			continue;
		}

		const variants = new Set([
			secret,
			secret.replaceAll('\\', '/'),
			encodeURIComponent(secret),
			encodeURI(secret)
		]);

		for (const variant of variants) {
			assert(
				!text.includes(variant),
				`${context} exposed an internal identifier or filesystem path.`
			);
		}
	}
}

async function seedTemporaryData(temporaryDatabase, temporaryAudioRoot) {
	temporaryClient = createClient({
		url: pathToFileURL(temporaryDatabase).href
	});

	const quickCheck = await temporaryClient.execute('pragma quick_check');
	assert(
		quickCheck.rows[0]?.quick_check === 'ok',
		'The temporary database copy failed SQLite quick_check.'
	);

	const suffix = `${Date.now()}_${randomBytes(4).toString('hex')}`;
	const userId = randomUUID();
	const username = `phase4_${randomBytes(5).toString('hex')}`;
	const email = `phase4-${suffix}@example.test`;
	const sessionId = randomUUID();
	const sessionToken = randomBytes(32).toString('base64url');
	const sessionTokenHash = createHash('sha256')
		.update(sessionToken, 'utf8')
		.digest('hex');
	const nowSeconds = Math.floor(Date.now() / 1000);

	await temporaryClient.execute({
		sql: 'insert into users (id, email, username, password_hash, created_at, updated_at) values (?, ?, ?, ?, ?, ?)',
		args: [
			userId,
			email,
			username,
			'synthetic-integration-password-hash',
			nowSeconds,
			nowSeconds
		]
	});
	await temporaryClient.execute({
		sql: 'insert into sessions (id, token_hash, user_id, expires_at, created_at) values (?, ?, ?, ?, ?)',
		args: [
			sessionId,
			sessionTokenHash,
			userId,
			nowSeconds + 3600,
			nowSeconds
		]
	});

	await mkdir(temporaryAudioRoot, { recursive: true });

	const publicInternalId = randomUUID();
	const privateInternalId = randomUUID();
	const missingInternalId = randomUUID();
	const publicStoredFilename = `${randomUUID()}.mp3`;
	const privateStoredFilename = `${randomUUID()}.ogg`;
	const missingStoredFilename = `${randomUUID()}.wav`;
	const publicTitle = `Phase 4 public ${suffix}`;
	const privateTitle = `Phase 4 private ${suffix}`;
	const missingTitle = `Phase 4 missing ${suffix}`;
	const publicBytes = Buffer.from(
		Array.from({ length: 64 }, (_, index) => (index * 7) % 256)
	);
	const privateBytes = Buffer.from([1, 2, 3, 4]);
	const originalFilename = 'Phase 4 čćž "mix"; final.mp3';

	await writeFile(join(temporaryAudioRoot, publicStoredFilename), publicBytes);
	await writeFile(join(temporaryAudioRoot, privateStoredFilename), privateBytes);

	const trackSql =
		'insert into tracks (id, owner_id, title, artist, bpm, musical_key, genre, description, original_filename, storage_key, mime_type, file_size_bytes, duration_ms, visibility, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';

	await temporaryClient.execute({
		sql: trackSql,
		args: [
			publicInternalId,
			userId,
			publicTitle,
			'Integration Artist',
			126,
			'C minor',
			'Techno',
			'Synthetic public integration track.',
			originalFilename,
			publicStoredFilename,
			'audio/mpeg',
			publicBytes.length,
			null,
			'public',
			nowSeconds,
			nowSeconds
		]
	});
	await temporaryClient.execute({
		sql: trackSql,
		args: [
			privateInternalId,
			userId,
			privateTitle,
			'Private Artist',
			null,
			null,
			null,
			null,
			'private.ogg',
			privateStoredFilename,
			'audio/ogg',
			privateBytes.length,
			null,
			'private',
			nowSeconds,
			nowSeconds
		]
	});
	await temporaryClient.execute({
		sql: trackSql,
		args: [
			missingInternalId,
			userId,
			missingTitle,
			'Missing Artist',
			null,
			null,
			null,
			null,
			'missing.wav',
			missingStoredFilename,
			'audio/wav',
			16,
			null,
			'public',
			nowSeconds,
			nowSeconds
		]
	});

	const ids = await temporaryClient.execute({
		sql: 'select public_id, id from tracks where id in (?, ?, ?)',
		args: [publicInternalId, privateInternalId, missingInternalId]
	});
	const publicIdByInternalId = new Map(
		ids.rows.map((row) => [String(row.id), Number(row.public_id)])
	);
	const maxIdResult = await temporaryClient.execute(
		'select max(public_id) as max_id from tracks'
	);

	return {
		userId,
		username,
		email,
		sessionToken,
		publicInternalId,
		privateInternalId,
		missingInternalId,
		publicId: publicIdByInternalId.get(publicInternalId),
		privateId: publicIdByInternalId.get(privateInternalId),
		missingId: publicIdByInternalId.get(missingInternalId),
		nonexistentId: Math.min(
			2_147_483_647,
			Number(maxIdResult.rows[0]?.max_id ?? 0) + 100_000
		),
		publicStoredFilename,
		privateStoredFilename,
		missingStoredFilename,
		publicTitle,
		privateTitle,
		publicBytes,
		originalFilename
	};
}

async function runHttpChecks(baseUrl, seed, cookieName, temporaryAudioRoot) {
	assert(
		Number.isSafeInteger(seed.publicId) &&
			seed.publicId > 0 &&
			Number.isSafeInteger(seed.privateId) &&
			seed.privateId > 0 &&
			Number.isSafeInteger(seed.missingId) &&
			seed.missingId > 0,
		'Temporary tracks did not receive positive public IDs.'
	);

	const responseArtifacts = [];
	const listResponse = await request(baseUrl, '/tracks');
	const listHtml = await listResponse.text();
	responseArtifacts.push(listHtml, recordHeaders(listResponse));
	assert(listResponse.status === 200, `GET /tracks returned ${listResponse.status}.`);
	console.log('[check 1/21] public track list returned 200');

	assert(listHtml.includes(seed.publicTitle), 'The public test track is missing from /tracks.');
	assert(!listHtml.includes(seed.privateTitle), 'A private test track appeared on /tracks.');
	console.log('[check 2/21] public track appears and private track is excluded');

	const detailResponse = await request(baseUrl, `/tracks/${seed.publicId}`);
	const detailHtml = await detailResponse.text();
	responseArtifacts.push(detailHtml, recordHeaders(detailResponse));
	assert(
		detailResponse.status === 200,
		`GET /tracks/${seed.publicId} returned ${detailResponse.status}.`
	);
	assert(detailHtml.includes(seed.publicTitle), 'The detail page omitted the public title.');
	console.log('[check 3/21] public detail returned 200 with safe metadata');

	const missingResponse = await request(baseUrl, `/tracks/${seed.nonexistentId}`);
	const missingBody = await missingResponse.text();
	const invalidIdResponse = await request(baseUrl, '/tracks/not-a-number');
	const invalidIdBody = await invalidIdResponse.text();
	responseArtifacts.push(
		missingBody,
		invalidIdBody,
		recordHeaders(missingResponse),
		recordHeaders(invalidIdResponse)
	);
	assert(
		missingResponse.status === 404 && invalidIdResponse.status === 404,
		'An invalid or missing track ID did not return 404.'
	);
	console.log('[check 4/21] invalid and missing tracks returned 404');

	const privateResponse = await request(baseUrl, `/tracks/${seed.privateId}`);
	const privateBody = await privateResponse.text();
	responseArtifacts.push(privateBody, recordHeaders(privateResponse));
	assert(privateResponse.status === 404, 'A private track detail did not return 404.');
	console.log('[check 5/21] private track detail returned the same safe 404');

	const fullStream = await request(
		baseUrl,
		`/api/tracks/${seed.publicId}/stream`
	);
	const fullBytes = new Uint8Array(await fullStream.arrayBuffer());
	responseArtifacts.push(recordHeaders(fullStream));
	assert(fullStream.status === 200, `Full stream returned ${fullStream.status}.`);
	assert(fullStream.headers.get('accept-ranges') === 'bytes', 'Full stream omitted Accept-Ranges.');
	assert(
		fullStream.headers.get('content-length') === String(seed.publicBytes.length),
		'Full stream Content-Length is incorrect.'
	);
	assert(fullStream.headers.get('x-content-type-options') === 'nosniff', 'Full stream omitted nosniff.');
	console.log('[check 6/21] full stream returned 200 with required headers');

	assertBytes(fullBytes, seed.publicBytes, 'Full stream');
	console.log('[check 7/21] full stream bytes match');

	const partialStream = await request(
		baseUrl,
		`/api/tracks/${seed.publicId}/stream`,
		{ headers: { Range: 'bytes=0-9' } }
	);
	const partialBytes = new Uint8Array(await partialStream.arrayBuffer());
	responseArtifacts.push(recordHeaders(partialStream));
	assert(partialStream.status === 206, `Partial stream returned ${partialStream.status}.`);
	console.log('[check 8/21] closed byte range returned 206');

	assert(
		partialStream.headers.get('content-range') ===
			`bytes 0-9/${seed.publicBytes.length}` &&
			partialStream.headers.get('content-length') === '10' &&
			partialStream.headers.get('accept-ranges') === 'bytes',
		'Partial stream headers are incorrect.'
	);
	console.log('[check 9/21] partial Content-Range and lengths are exact');

	assertBytes(partialBytes, seed.publicBytes.subarray(0, 10), 'Partial stream');
	console.log('[check 10/21] partial stream bytes match');

	const openEnded = await request(
		baseUrl,
		`/api/tracks/${seed.publicId}/stream`,
		{ headers: { Range: 'bytes=10-' } }
	);
	assert(openEnded.status === 206, 'Open-ended range did not return 206.');
	assertBytes(
		new Uint8Array(await openEnded.arrayBuffer()),
		seed.publicBytes.subarray(10),
		'Open-ended stream'
	);
	responseArtifacts.push(recordHeaders(openEnded));
	console.log('[check 11/21] open-ended range works');

	const suffixStream = await request(
		baseUrl,
		`/api/tracks/${seed.publicId}/stream`,
		{ headers: { Range: 'bytes=-7' } }
	);
	assert(suffixStream.status === 206, 'Suffix range did not return 206.');
	assertBytes(
		new Uint8Array(await suffixStream.arrayBuffer()),
		seed.publicBytes.subarray(seed.publicBytes.length - 7),
		'Suffix stream'
	);
	responseArtifacts.push(recordHeaders(suffixStream));
	console.log('[check 12/21] suffix range works');

	const invalidRange = await request(
		baseUrl,
		`/api/tracks/${seed.publicId}/stream`,
		{ headers: { Range: `bytes=${seed.publicBytes.length}-` } }
	);
	const invalidRangeBody = await invalidRange.text();
	responseArtifacts.push(invalidRangeBody, recordHeaders(invalidRange));
	assert(
		invalidRange.status === 416 &&
			invalidRange.headers.get('content-range') ===
				`bytes */${seed.publicBytes.length}`,
		'An unsatisfiable range did not return the required 416 response.'
	);
	console.log('[check 13/21] unsatisfiable range returned 416');

	const multipleRange = await request(
		baseUrl,
		`/api/tracks/${seed.publicId}/stream`,
		{ headers: { Range: 'bytes=0-1,4-5' } }
	);
	const multipleRangeBody = await multipleRange.text();
	responseArtifacts.push(multipleRangeBody, recordHeaders(multipleRange));
	assert(multipleRange.status === 416, 'A multiple range was not rejected with 416.');
	console.log('[check 14/21] multiple ranges are rejected safely');

	const downloadResponse = await request(
		baseUrl,
		`/api/tracks/${seed.publicId}/download`
	);
	const downloadBytes = new Uint8Array(await downloadResponse.arrayBuffer());
	responseArtifacts.push(recordHeaders(downloadResponse));
	assert(downloadResponse.status === 200, `Download returned ${downloadResponse.status}.`);
	assert(
		downloadResponse.headers.get('x-content-type-options') === 'nosniff' &&
			downloadResponse.headers.get('content-length') ===
				String(seed.publicBytes.length),
		'Download security or length headers are incorrect.'
	);
	console.log('[check 15/21] download returned 200 with required headers');

	const disposition = downloadResponse.headers.get('content-disposition') || '';
	assert(
		disposition.startsWith('attachment;') &&
			disposition.includes('filename=') &&
			disposition.includes(`filename*=UTF-8''`) &&
			!disposition.includes(seed.publicStoredFilename),
		'Download Content-Disposition is unsafe or incomplete.'
	);
	console.log('[check 16/21] download filename is attachment-safe and UTF-8 encoded');

	assertBytes(downloadBytes, seed.publicBytes, 'Download');
	console.log('[check 17/21] downloaded bytes match');

	const listDataResponse = await request(baseUrl, '/tracks/__data.json');
	const detailDataResponse = await request(
		baseUrl,
		`/tracks/${seed.publicId}/__data.json`
	);
	const listData = await listDataResponse.text();
	const detailData = await detailDataResponse.text();
	responseArtifacts.push(
		listData,
		detailData,
		recordHeaders(listDataResponse),
		recordHeaders(detailDataResponse)
	);
	assert(
		listDataResponse.status === 200 && detailDataResponse.status === 200,
		'Public SvelteKit data requests did not return 200.'
	);

	const internalSecrets = [
		seed.publicInternalId,
		seed.privateInternalId,
		seed.missingInternalId,
		seed.publicStoredFilename,
		seed.privateStoredFilename,
		seed.missingStoredFilename,
		seed.userId,
		seed.email
	];
	assertNoSecrets(
		`${listHtml}\n${detailHtml}\n${listData}\n${detailData}`,
		internalSecrets,
		'Public track HTML or page data'
	);
	console.log('[check 18/21] HTML and page data contain no internal IDs or stored filenames');

	const privateStream = await request(
		baseUrl,
		`/api/tracks/${seed.privateId}/stream`
	);
	const privateDownload = await request(
		baseUrl,
		`/api/tracks/${seed.privateId}/download`
	);
	const missingStream = await request(
		baseUrl,
		`/api/tracks/${seed.missingId}/stream`
	);
	const missingDownload = await request(
		baseUrl,
		`/api/tracks/${seed.missingId}/download`
	);
	const unavailableBodies = await Promise.all([
		privateStream.text(),
		privateDownload.text(),
		missingStream.text(),
		missingDownload.text()
	]);
	assert(
		[privateStream, privateDownload, missingStream, missingDownload].every(
			(response) => response.status === 404
		),
		'Private or missing-file media did not consistently return 404.'
	);
	responseArtifacts.push(...unavailableBodies);

	const physicalSecrets = [
		temporaryRoot,
		temporaryAudioRoot,
		resolveConfiguredPath(process.env.DATABASE_URL, 'data/app.db'),
		resolveConfiguredPath(process.env.AUDIO_STORAGE_PATH, 'storage/audio')
	];
	assertNoSecrets(
		responseArtifacts.join('\n'),
		[...internalSecrets, ...physicalSecrets],
		'An HTTP response'
	);
	console.log('[check 19/21] responses expose no physical paths or private storage identifiers');

	const uploadTitle = `Phase 4 upload ${Date.now()} ${randomBytes(3).toString('hex')}`;
	const uploadForm = new FormData();
	uploadForm.set('title', uploadTitle);
	uploadForm.set('artist', 'Uploaded Integration Artist');
	uploadForm.set('bpm', '130');
	uploadForm.set('musicalKey', 'D minor');
	uploadForm.set('genre', 'Electronic');
	uploadForm.set('description', 'Synthetic integration upload.');
	uploadForm.set(
		'audioFile',
		new File([seed.publicBytes], 'Integration upload.mp3', {
			type: 'audio/mpeg'
		})
	);
	const cookie = `${cookieName}=${seed.sessionToken}`;
	const audioBeforeUpload = (await readdir(temporaryAudioRoot)).sort();
	const uploadResponse = await request(baseUrl, '/upload', {
		method: 'POST',
		headers: {
			Cookie: cookie,
			Origin: baseUrl,
			Accept: 'text/html'
		},
		body: uploadForm
	});
	const uploadLocation = uploadResponse.headers.get('location') || '';
	const uploadLocationMatch = /^\/tracks\/([1-9]\d*)\?uploaded=1$/.exec(
		uploadLocation
	);
	assert(
		uploadResponse.status === 303 && uploadLocationMatch,
		`Successful upload returned ${uploadResponse.status} with location ${uploadLocation}.`
	);
	const uploadedPublicId = Number(uploadLocationMatch[1]);
	const uploadedRows = await temporaryClient.execute({
		sql: 'select public_id, owner_id, visibility, storage_key from tracks where title = ?',
		args: [uploadTitle]
	});
	const audioAfterUpload = (await readdir(temporaryAudioRoot)).sort();
	assert(
		uploadedRows.rows.length === 1 &&
			Number(uploadedRows.rows[0].public_id) === uploadedPublicId &&
			uploadedRows.rows[0].owner_id === seed.userId &&
			uploadedRows.rows[0].visibility === 'public' &&
			audioAfterUpload.length === audioBeforeUpload.length + 1,
		'The redirected upload did not preserve owner/public visibility or exact persistence.'
	);
	console.log('[check 20/21] upload redirects to the numeric public detail ID');

	const uploadedDetail = await request(baseUrl, uploadLocation);
	const uploadedDetailHtml = await uploadedDetail.text();
	const refreshedDetail = await request(baseUrl, uploadLocation);
	await refreshedDetail.text();
	const rowsAfterRefresh = await temporaryClient.execute({
		sql: 'select count(*) as count from tracks where title = ?',
		args: [uploadTitle]
	});
	const audioAfterRefresh = (await readdir(temporaryAudioRoot)).sort();
	assert(
		uploadedDetail.status === 200 &&
			refreshedDetail.status === 200 &&
			uploadedDetailHtml.includes('Audio track uploaded successfully.') &&
			Number(rowsAfterRefresh.rows[0].count) === 1 &&
			JSON.stringify(audioAfterRefresh) === JSON.stringify(audioAfterUpload),
		'Refreshing the uploaded detail page duplicated the upload or lost the confirmation.'
	);
	console.log('[check 21/21] detail refresh is safe and does not duplicate the upload');
}

async function runIntegration() {
	const realDatabase = resolveConfiguredPath(
		process.env.DATABASE_URL,
		'data/app.db'
	);
	const realAudioRoot = resolveConfiguredPath(
		process.env.AUDIO_STORAGE_PATH,
		'storage/audio'
	);
	const realStateBefore = await realStateSnapshot(realDatabase, realAudioRoot);
	realStateForCleanup = {
		realDatabase,
		realAudioRoot,
		realStateBefore
	};

	temporaryRoot = await mkdtemp(join(resolve(tmpdir()), TEMP_PREFIX));
	assert(
		isSafeTemporaryRoot(temporaryRoot),
		'The generated integration root is outside the validated temporary parent.'
	);

	const temporaryDatabase = join(temporaryRoot, 'app.db');
	const temporaryAudioRoot = join(temporaryRoot, 'audio');
	stdoutPath = join(temporaryRoot, 'vite.out.log');
	stderrPath = join(temporaryRoot, 'vite.err.log');
	await Promise.all([writeFile(stdoutPath, ''), writeFile(stderrPath, '')]);
	await copyDatabaseSnapshot(realDatabase, temporaryDatabase);

	const seed = await seedTemporaryData(temporaryDatabase, temporaryAudioRoot);
	testPort = await reservePort();
	const baseUrl = `http://127.0.0.1:${testPort}`;
	const cookieName = `phase4_integration_${randomBytes(4).toString('hex')}`;

	console.log(`[setup] isolated port: ${testPort}`);
	console.log('[setup] temporary database copy and audio storage are ready');

	child = spawn(
		process.execPath,
		[
			resolve(PROJECT_ROOT, 'node_modules/vite/bin/vite.js'),
			'dev',
			'--host',
			'127.0.0.1',
			'--port',
			String(testPort),
			'--strictPort'
		],
		{
			cwd: PROJECT_ROOT,
			env: {
				...process.env,
				DATABASE_URL: temporaryDatabase,
				AUDIO_STORAGE_PATH: temporaryAudioRoot,
				MAX_AUDIO_FILE_SIZE_MB: '2',
				BODY_SIZE_LIMIT: '3M',
				SESSION_COOKIE_NAME: cookieName
			},
			detached: true,
			shell: false,
			stdio: ['ignore', 'pipe', 'pipe'],
			windowsHide: true
		}
	);
	childExitPromise = new Promise((resolveExit) => {
		child.once('exit', (code, signal) => resolveExit({ code, signal }));
	});
	child.stdout.on('data', (chunk) => {
		const text = chunk.toString();
		stdoutTail = updateTail(stdoutTail, text);
		appendFileSync(stdoutPath, text);
	});
	child.stderr.on('data', (chunk) => {
		const text = chunk.toString();
		stderrTail = updateTail(stderrTail, text);
		appendFileSync(stderrPath, text);
	});
	child.on('error', (error) => {
		const text = `[child process error] ${error.name}\n`;
		stderrTail = updateTail(stderrTail, text);
		appendFileSync(stderrPath, text);
	});

	await waitForStartup(baseUrl);
	await runHttpChecks(baseUrl, seed, cookieName, temporaryAudioRoot);

	const realStateDuring = await realStateSnapshot(realDatabase, realAudioRoot);
	assert(
		snapshotsEqual(realStateBefore, realStateDuring),
		'The real database or audio storage changed during isolated integration tests.'
	);
	console.log('[isolation] real database and storage/audio remained unchanged');

	return { realDatabase, realAudioRoot, realStateBefore };
}

async function cleanup(realState) {
	const cleanupErrors = [];
	overallController.abort();

	try {
		temporaryClient?.close();
	} catch (error) {
		cleanupErrors.push(error);
	}

	try {
		await stopChildProcess();
	} catch (error) {
		cleanupErrors.push(error);
	}

	if (testPort) {
		try {
			assert(
				!(await canConnect(testPort)),
				`The integration port ${testPort} is still accepting connections.`
			);
		} catch (error) {
			cleanupErrors.push(error);
		}
	}

	if (child?.pid) {
		try {
			assert(
				!isProcessAlive(child.pid),
				`The integration Vite process ${child.pid} is still alive.`
			);
		} catch (error) {
			cleanupErrors.push(error);
		}
	}

	if (realState) {
		try {
			const realStateAfter = await realStateSnapshot(
				realState.realDatabase,
				realState.realAudioRoot
			);
			assert(
				snapshotsEqual(realState.realStateBefore, realStateAfter),
				'The real database or audio storage changed during integration cleanup.'
			);
		} catch (error) {
			cleanupErrors.push(error);
		}
	}

	if (temporaryRoot && existsSync(temporaryRoot)) {
		try {
			assert(
				isSafeTemporaryRoot(temporaryRoot),
				'Refusing to remove an unvalidated temporary directory.'
			);
			await rm(temporaryRoot, {
				recursive: true,
				force: true,
				maxRetries: 20,
				retryDelay: 250
			});
			assert(
				!existsSync(temporaryRoot),
				'The integration temporary directory was not removed.'
			);
		} catch (error) {
			cleanupErrors.push(error);
		}
	}

	if (cleanupErrors.length > 0) {
		throw new AggregateError(cleanupErrors, 'Phase 4 integration cleanup failed.');
	}

	console.log('[cleanup] Vite stopped, port released, and temporary directory removed');
}

let primaryError;
let integrationPassed = false;
const overallTimer = setTimeout(() => {
	overallController.abort(
		new Error('The Phase 4 integration test exceeded its 180-second timeout.')
	);
}, OVERALL_TIMEOUT_MS);

try {
	await Promise.race([
		runIntegration(),
		new Promise((_, reject) => {
			overallController.signal.addEventListener(
				'abort',
				() => reject(overallController.signal.reason),
				{ once: true }
			);
		})
	]);
	integrationPassed = true;
} catch (error) {
	primaryError = error;
	console.error(
		`[failure] ${error instanceof Error ? error.message : String(error)}`
	);

	if (!startupComplete) {
		printServerLogs();
	}
} finally {
	clearTimeout(overallTimer);

	try {
		await cleanup(realStateForCleanup);
	} catch (cleanupError) {
		console.error(
			`[cleanup failure] ${
				cleanupError instanceof Error
					? cleanupError.message
					: String(cleanupError)
			}`
		);

		if (!primaryError) {
			primaryError = cleanupError;
		}
	}
}

if (primaryError) {
	process.exitCode = 1;
} else if (integrationPassed) {
	console.log('PHASE4_INTEGRATION_CHECKS_PASSED=21');
}
