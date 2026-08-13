import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { config as loadEnvironment } from 'dotenv';
import { MongoClientManager } from '../src/lib/server/mongodb/client.ts';
import {
	assertMongoTestDatabaseName,
	MONGODB_TEST_DATABASE_PREFIX,
	readMongoConfig
} from '../src/lib/server/mongodb/config.ts';
import { getMongoCollections } from '../src/lib/server/mongodb/collections.ts';
import { TRACK_PUBLIC_ID_COUNTER } from '../src/lib/server/mongodb/documents.ts';
import { ensureMongoIndexes } from '../src/lib/server/mongodb/indexes.ts';
import { hashSessionToken } from '../src/lib/server/auth/session-token.ts';
import { safeMongoAggregateFingerprint } from './lib/mongodb-fingerprint.mjs';
import { createSyntheticApplicationEnvironment } from './lib/synthetic-app-environment.mjs';

loadEnvironment({
	path: existsSync(resolve('.env')) ? resolve('.env') : resolve('.env.example'),
	override: false,
	quiet: true
});

const VIEWPORTS = [
	[1920, 1080],
	[1440, 900],
	[1024, 768],
	[768, 1024],
	[390, 844],
	[375, 667],
	[360, 800],
	[320, 568]
];
const TEMP_PREFIX = 'audio-library-visual-viewport-';
const STARTUP_TIMEOUT_MS = 60_000;
const PAGE_TIMEOUT_MS = 30_000;
const BROWSER_COMMAND_TIMEOUT_MS = 20_000;
const OVERALL_TIMEOUT_MS = 12 * 60_000;
const THEME_STORAGE_KEY = 'audio-library-theme';
const THEMES = ['dark', 'light'];
const SYNTHETIC_AUDIO = new Uint8Array([
	0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00,
	0x00, 0x0f, 0x54, 0x49, 0x54, 0x32, 0x00, 0x00,
	0x00, 0x05, 0x00, 0x00, 0x50, 0x33, 0x00, 0x01
]);
const SYNTHETIC_PNG = Uint8Array.from(
	Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
		'base64'
	)
);

function browserBinary() {
	const candidates = [
		process.env.CHROME_BINARY?.trim(),
		'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
		'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
		'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
		'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
		'/usr/bin/google-chrome',
		'/usr/bin/chromium',
		'/usr/bin/chromium-browser'
	].filter(Boolean);
	const binary = candidates.find((path) => existsSync(path));
	if (!binary) throw new Error('Chrome, Edge, or Chromium is required for visual verification.');
	return binary;
}

function ownedDatabaseName(base, developmentName) {
	const suffix = `_visual_${randomBytes(6).toString('hex')}`;
	const name = `${base.slice(0, 63 - suffix.length)}${suffix}`;
	assertMongoTestDatabaseName(name, developmentName);
	return name;
}

function isOwnedTemporaryRoot(path) {
	const absolute = resolve(path);
	return (
		dirname(absolute) === resolve(tmpdir()) &&
		basename(absolute).startsWith(TEMP_PREFIX)
	);
}

async function reservePort() {
	return new Promise((resolvePort, rejectPort) => {
		const server = createServer();
		server.unref();
		server.once('error', rejectPort);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			const port = typeof address === 'object' && address ? address.port : null;
			server.close((error) => {
				if (error) rejectPort(error);
				else if (port === null) rejectPort(new Error('Unable to reserve an owned viewport port.'));
				else resolvePort(port);
			});
		});
	});
}

async function waitForApplication(baseUrl, child) {
	const deadline = Date.now() + STARTUP_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) throw new Error('Visual-test application exited during startup.');
		try {
			const response = await fetch(`${baseUrl}/login`, {
				signal: AbortSignal.timeout(1_500)
			});
			await response.body?.cancel();
			if (response.status === 200) return;
		} catch {
		}
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
	}
	throw new Error('Visual-test application did not start within 60 seconds.');
}

async function waitForBrowser(debugPort, child) {
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) throw new Error('Headless browser exited during startup.');
		try {
			const pages = await fetch(`http://127.0.0.1:${debugPort}/json/list`, {
				signal: AbortSignal.timeout(1_000)
			}).then((response) => response.json());
			const page = pages.find(({ type }) => type === 'page');
			if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
		} catch {
		}
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
	}
	throw new Error('Headless browser debugging endpoint did not start in time.');
}

async function stopChild(child) {
	if (!child || child.exitCode !== null) return;
	const closed = new Promise((resolveClose) => child.once('close', resolveClose));
	child.kill();
	let timer;
	await Promise.race([
		closed,
		new Promise((resolveDelay) => {
			timer = setTimeout(resolveDelay, 5_000);
		})
	]);
	clearTimeout(timer);
	if (child.exitCode === null) {
		child.kill('SIGKILL');
		await Promise.race([
			closed,
			new Promise((resolveDelay) => {
				timer = setTimeout(resolveDelay, 5_000);
			})
		]);
		clearTimeout(timer);
	}
}

async function connectCdp(url) {
	const socket = new WebSocket(url);
	await new Promise((resolveOpen, rejectOpen) => {
		socket.addEventListener('open', resolveOpen, { once: true });
		socket.addEventListener('error', rejectOpen, { once: true });
	});
	let nextId = 0;
	const pending = new Map();
	let intentionalClose = false;
	socket.addEventListener('message', ({ data }) => {
		const message = JSON.parse(String(data));
		if (!message.id) return;
		const handler = pending.get(message.id);
		if (!handler) return;
		pending.delete(message.id);
		clearTimeout(handler.timer);
		if (message.error) handler.reject(new Error(message.error.message));
		else handler.resolve(message.result);
	});
	socket.addEventListener('close', () => {
		for (const handler of pending.values()) {
			clearTimeout(handler.timer);
			if (!intentionalClose) {
				handler.reject(new Error(`Browser connection closed during ${handler.method}.`));
			}
		}
		pending.clear();
	});

	return {
		command(method, params = {}) {
			const id = ++nextId;
			return new Promise((resolveCommand, rejectCommand) => {
				const timer = setTimeout(() => {
					pending.delete(id);
					rejectCommand(new Error(`Browser command timed out: ${method}.`));
				}, BROWSER_COMMAND_TIMEOUT_MS);
				pending.set(id, { resolve: resolveCommand, reject: rejectCommand, timer, method });
				socket.send(JSON.stringify({ id, method, params }));
			});
		},
		close() {
			intentionalClose = true;
			socket.close();
		}
	};
}

async function evaluate(cdp, expression) {
	const result = await cdp.command('Runtime.evaluate', {
		expression,
		returnByValue: true,
		awaitPromise: true
	});
	if (result.exceptionDetails) {
		throw new Error(
			`Browser evaluation failed: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}.`
		);
	}
	return result.result.value;
}

async function navigate(cdp, url, selector) {
	await cdp.command('Page.navigate', { url });
	const deadline = Date.now() + PAGE_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const ready = await evaluate(
			cdp,
			`document.readyState === 'complete' && Boolean(document.querySelector(${JSON.stringify(selector)}))`
		);
		if (ready) return;
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
	}
	throw new Error(`Page did not reach the expected state: ${selector}.`);
}

async function reload(cdp, selector) {
	await cdp.command('Page.reload', { ignoreCache: true });
	const deadline = Date.now() + PAGE_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const ready = await evaluate(
			cdp,
			`document.readyState === 'complete' && Boolean(document.querySelector(${JSON.stringify(selector)}))`
		);
		if (ready) return;
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
	}
	throw new Error(`Reload did not reach the expected state: ${selector}.`);
}

async function saveThemeAndReload(cdp, theme, selector) {
	await evaluate(
		cdp,
		`localStorage.setItem(${JSON.stringify(THEME_STORAGE_KEY)}, ${JSON.stringify(theme)})`
	);
	await reload(cdp, selector);
}

async function waitForFirstPaintTheme(cdp) {
	const deadline = Date.now() + PAGE_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const theme = await evaluate(cdp, 'window.__audioLibraryThemeAtFirstPaint ?? null');
		if (theme !== null) return theme;
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
	}
	throw new Error('Timed out waiting for the first-paint theme observation.');
}

async function waitForThemeUi(cdp) {
	const deadline = Date.now() + PAGE_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const ready = await evaluate(cdp, `(() => {
			const theme = document.documentElement.dataset.theme;
			const expected = theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode';
			return document.querySelector('.theme-toggle')?.getAttribute('aria-label') === expected;
		})()`);
		if (ready) return;
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
	}
	throw new Error('Timed out waiting for the hydrated theme control.');
}

async function currentThemeState(cdp) {
	await waitForFirstPaintTheme(cdp);
	await waitForThemeUi(cdp);
	return evaluate(cdp, `(() => ({
		theme: document.documentElement.dataset.theme,
		stored: localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)}),
		firstFrame: window.__audioLibraryThemeAtFirstPaint ?? null,
		label: document.querySelector('.theme-toggle')?.getAttribute('aria-label') ?? null,
		colorScheme: getComputedStyle(document.documentElement).colorScheme
	}))()`);
}

function assertThemeState(
	state,
	expectedTheme,
	expectedStored = expectedTheme,
	expectedFirstPaint = expectedTheme
) {
	assert.equal(state.theme, expectedTheme);
	assert.equal(state.stored, expectedStored);
	assert.equal(state.firstFrame, expectedFirstPaint);
	assert.equal(
		state.label,
		expectedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
	);
	assert.ok(state.colorScheme.includes(expectedTheme));
}

async function activateAndWaitForPlayer(cdp) {
	const deadline = Date.now() + PAGE_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const ready = await evaluate(cdp, `(() => {
			if (document.querySelector('.global-player')) return true;
			document.querySelector('.track-card .track-play-button--icon')?.click();
			return false;
		})()`);
		if (ready) return;
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
	}
	throw new Error('Timed out waiting for the loaded global-player state.');
}

async function openAndInspectPlaylistDialog(cdp) {
	const deadline = Date.now() + PAGE_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const state = await evaluate(cdp, `(() => {
			const dialog = document.querySelector('.playlist-dialog');
			const trigger = document.querySelector('.track-card .playlist-trigger');
			if (!trigger) return { triggerFound: false, open: false };
			if (!dialog?.open) trigger.click();
			if (!dialog?.open) return { triggerFound: true, open: false };
			const style = getComputedStyle(dialog);
			const result = {
				triggerFound: true,
				open: true,
				background: style.backgroundColor,
				color: style.color
			};
			dialog.close();
			return result;
		})()`);
		if (!state.triggerFound) {
			throw new Error('Add to playlist trigger was unavailable.');
		}
		if (state.open) return state;
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
	}
	throw new Error('Timed out waiting for the Add to playlist dialog.');
}

async function commonPageState(cdp) {
	await waitForFirstPaintTheme(cdp);
	await waitForThemeUi(cdp);
	return evaluate(cdp, `(() => {
		const channel = (value) => {
			const match = value.match(/[\\d.]+/g)?.map(Number) ?? [];
			return match.slice(0, 3).map((component) => {
				const normalized = component / 255;
				return normalized <= 0.03928
					? normalized / 12.92
					: ((normalized + 0.055) / 1.055) ** 2.4;
			});
		};
		const luminance = (value) => {
			const [red = 0, green = 0, blue = 0] = channel(value);
			return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
		};
		const contrast = (foreground, background) => {
			const first = luminance(foreground);
			const second = luminance(background);
			return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
		};
		const header = document.querySelector('.site-header');
		const headerRect = header?.getBoundingClientRect();
		const bodyStyle = getComputedStyle(document.body);
		const rootStyle = getComputedStyle(document.documentElement);
		const toggle = document.querySelector('.theme-toggle');
		const toggleRect = toggle?.getBoundingClientRect();
		const text = document.body.textContent || '';
		return {
			innerWidth: window.innerWidth,
			clientWidth: document.documentElement.clientWidth,
			scrollWidth: document.documentElement.scrollWidth,
			bodyMargin: bodyStyle.margin,
			theme: document.documentElement.dataset.theme,
			storedTheme: localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)}),
			firstFrameTheme: window.__audioLibraryThemeAtFirstPaint ?? null,
			colorScheme: rootStyle.colorScheme,
			toggleLabel: toggle?.getAttribute('aria-label') ?? null,
			toggleVisible: Boolean(
				toggleRect &&
					toggleRect.width > 0 &&
					toggleRect.height > 0 &&
					getComputedStyle(toggle).visibility !== 'hidden'
			),
			bodyContrast: contrast(bodyStyle.color, bodyStyle.backgroundColor),
			bodyColor: bodyStyle.color,
			bodyBackground: bodyStyle.backgroundColor,
			accent: rootStyle.getPropertyValue('--accent').trim().toLowerCase(),
			pageBackgroundToken: rootStyle.getPropertyValue('--page-bg').trim().toLowerCase(),
			cardBackgroundToken: rootStyle.getPropertyValue('--card-background').trim().toLowerCase(),
			headerLeft: headerRect?.left ?? null,
			headerRight: headerRect?.right ?? null,
			fakeStatistics: ['250K+ Tracks', '120K+ Creators', '2M+ Downloads', '190+ Countries']
				.some((value) => text.includes(value)),
			fakeLinks: [...document.querySelectorAll('a')]
				.some((link) => ['Pricing', 'For Creators'].includes(link.textContent.trim())),
			closeControls: document.querySelectorAll('[aria-label="Close audio player"]').length
		};
	})()`);
}

function assertCommonPageState(state, width, theme) {
	assert.equal(state.innerWidth, width);
	assert.ok(
		state.scrollWidth <= state.clientWidth,
		`Horizontal overflow: ${state.scrollWidth} > ${state.clientWidth}.`
	);
	assert.equal(state.bodyMargin, '0px');
	assert.equal(state.theme, theme);
	assert.equal(state.storedTheme, theme);
	assert.equal(state.firstFrameTheme, theme);
	assert.ok(state.colorScheme.includes(theme));
	assert.equal(
		state.toggleLabel,
		theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
	);
	assert.equal(state.toggleVisible, true);
	assert.ok(state.bodyContrast >= 4.5, `Insufficient body contrast: ${state.bodyContrast}.`);
	assert.notEqual(state.bodyColor, 'rgba(0, 0, 0, 0)');
	assert.notEqual(state.bodyBackground, 'rgba(0, 0, 0, 0)');
	assert.equal(state.accent, theme === 'dark' ? '#d81f61' : '#d4145a');
	assert.equal(state.pageBackgroundToken, theme === 'dark' ? '#120a0f' : '#fff9fb');
	assert.equal(state.cardBackgroundToken.includes('#070b18'), false);
	assert.equal(state.cardBackgroundToken.includes('#10182e'), false);
	assert.ok(Math.abs(state.headerLeft) <= 0.5);
	assert.ok(Math.abs(state.headerRight - state.clientWidth) <= 0.5);
	assert.equal(state.fakeStatistics, false);
	assert.equal(state.fakeLinks, false);
	assert.equal(state.closeControls, 0);
}

async function verifyVisibleFocus(cdp) {
	await cdp.command('Input.dispatchKeyEvent', {
		type: 'keyDown',
		key: 'Tab',
		code: 'Tab',
		windowsVirtualKeyCode: 9,
		nativeVirtualKeyCode: 9
	});
	await cdp.command('Input.dispatchKeyEvent', {
		type: 'keyUp',
		key: 'Tab',
		code: 'Tab',
		windowsVirtualKeyCode: 9,
		nativeVirtualKeyCode: 9
	});
	const focus = await evaluate(cdp, `(() => {
		const target = document.activeElement;
		const style = getComputedStyle(target);
		return {
			interactive: target.matches('a, button, input, select, textarea'),
			visible: target.matches(':focus-visible'),
			outlineStyle: style.outlineStyle,
			outlineWidth: style.outlineWidth
		};
	})()`);
	assert.equal(focus.interactive, true);
	assert.equal(focus.visible, true);
	assert.notEqual(focus.outlineStyle, 'none');
	assert.notEqual(focus.outlineWidth, '0px');
}

async function verifyFilterLayout(cdp, width) {
	const state = await evaluate(cdp, `(() => {
		const rect = (selector) => {
			const element = document.querySelector(selector);
			const value = element.getBoundingClientRect();
			return { left: value.left, right: value.right, top: value.top, width: value.width };
		};
		return {
			form: rect('.track-filters__form'),
			search: rect('.track-filters__search'),
			bpmGroup: rect('.track-filters__bpm-group'),
			minimum: rect('#track-bpm-min'),
			maximum: rect('#track-bpm-max'),
			key: rect('#track-musical-key'),
			genre: rect('#track-genre'),
			sort: rect('#track-sort'),
			actions: rect('.track-filters__actions'),
			apply: rect('.track-filters__actions .primary-button'),
			resetCount: [...document.querySelectorAll('.track-filters__actions a')]
				.filter((link) => link.textContent.trim() === 'Reset filters').length
		};
	})()`);
	assert.equal(state.resetCount, 1);
	for (const item of [state.search, state.bpmGroup, state.minimum, state.maximum, state.key, state.genre, state.sort, state.actions]) {
		assert.ok(item.left >= state.form.left - 1);
		assert.ok(item.right <= state.form.right + 1);
	}
	if (width >= 700) {
		assert.ok(Math.abs(state.minimum.top - state.maximum.top) <= 3);
	}
	if (width > 1100) {
		assert.ok(Math.abs(state.search.top - state.bpmGroup.top) <= 3);
		assert.ok(Math.abs(state.key.top - state.genre.top) <= 3);
		assert.ok(Math.abs(state.genre.top - state.sort.top) <= 3);
		assert.ok(Math.abs(state.sort.top - state.apply.top) <= 4);
		assert.ok(state.key.top > state.search.top);
	} else if (width >= 700) {
		assert.ok(state.search.width >= state.form.width * 0.95);
		assert.ok(state.minimum.width < state.search.width);
		assert.ok(state.maximum.width < state.search.width);
	} else {
		assert.ok(state.search.width >= state.form.width * 0.95);
		assert.ok(state.apply.width >= state.actions.width * 0.95);
	}
}

async function verifyNarrowBrowseLayout(cdp, width) {
	if (width > 390) return;
	const state = await evaluate(cdp, `(() => {
		const contained = (element, container) => {
			const rect = element.getBoundingClientRect();
			const bounds = container.getBoundingClientRect();
			return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1;
		};
		const hero = document.querySelector('.tracks-hero');
		const heading = document.querySelector('.tracks-heading');
		const intro = document.querySelector('.tracks-intro');
		const filters = document.querySelector('.track-filters');
		const controls = [...filters.querySelectorAll('input, select, button, a')];
		const cards = [...document.querySelectorAll('.track-card')];
		return {
			documentFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
			heroFits: hero.scrollWidth <= hero.clientWidth + 1,
			heroStacked: intro.getBoundingClientRect().top >= heading.getBoundingClientRect().bottom - 1,
			filtersFit: filters.scrollWidth <= filters.clientWidth + 1,
			controlsFit: controls.every((control) => contained(control, filters)),
			cardsFit: cards.every((card) => card.scrollWidth <= card.clientWidth + 1),
			cardContentFits: cards.every((card) => {
				const parts = [...card.querySelectorAll('.track-card__identity, .track-card__genre, .track-card__metadata, .track-card__actions')];
				return parts.every((part) => contained(part, card));
			}),
			identitySafe: cards.every((card) => {
				const identity = card.querySelector('.track-card__identity');
				return identity.scrollWidth <= identity.clientWidth + 1;
			})
		};
	})()`);
	assert.equal(state.documentFits, true);
	assert.equal(state.heroFits, true);
	assert.equal(state.heroStacked, true);
	assert.equal(state.filtersFit, true);
	assert.equal(state.controlsFit, true);
	assert.equal(state.cardsFit, true);
	assert.equal(state.cardContentFits, true);
	assert.equal(state.identitySafe, true);
}

async function setFileInputFiles(cdp, selector, files) {
	const { root } = await cdp.command('DOM.getDocument');
	const { nodeId } = await cdp.command('DOM.querySelector', {
		nodeId: root.nodeId,
		selector
	});
	assert.ok(nodeId, `File input ${selector} was unavailable.`);
	await cdp.command('DOM.setFileInputFiles', { files, nodeId });
	await evaluate(
		cdp,
		`document.querySelector(${JSON.stringify(selector)})?.dispatchEvent(new Event('change', { bubbles: true }))`
	);
}

async function verifyUploadFilePicker(cdp, baseUrl, width, theme, uploadFixturePath, uploadFilename) {
	await navigate(cdp, `${baseUrl}/upload`, '#audioFile');
	assertCommonPageState(await commonPageState(cdp), width, theme);
	await setFileInputFiles(cdp, '#audioFile', [uploadFixturePath]);
	const state = await evaluate(cdp, `(() => {
		const input = document.querySelector('#audioFile');
		const formFile = new FormData(input.form).get('audioFile');
		const filename = document.querySelector('#audioFile-filename');
		const button = document.querySelector('label.file-picker__button[for="audioFile"]');
		const coverInput = document.querySelector('#coverImage');
		return {
			documentFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
			formFits: input.form.scrollWidth <= input.form.clientWidth + 1,
			inputType: input.type,
			inputName: input.name,
			inputAcceptsAudio: input.accept.includes('audio/mpeg') && input.accept.includes('.ogg'),
			required: input.required,
			buttonText: button?.textContent.trim(),
			buttonFor: button?.htmlFor,
			filename: filename?.textContent.trim(),
			filenameTitle: filename?.getAttribute('title'),
			filenameStyle: {
				overflow: getComputedStyle(filename).overflow,
				textOverflow: getComputedStyle(filename).textOverflow,
				whiteSpace: getComputedStyle(filename).whiteSpace
			},
			selectedName: input.files?.[0]?.name,
			formName: formFile instanceof File ? formFile.name : null,
			formSize: formFile instanceof File ? formFile.size : null,
			selectedSize: input.files?.[0]?.size,
			coverUsesPicker: Boolean(coverInput?.classList.contains('file-picker__input')),
			coverVisibleLabel: document.querySelector('label.file-picker__button[for="coverImage"]')?.textContent.trim()
		};
	})()`);
	assert.equal(state.documentFits, true);
	assert.equal(state.formFits, true);
	assert.equal(state.inputType, 'file');
	assert.equal(state.inputName, 'audioFile');
	assert.equal(state.inputAcceptsAudio, true);
	assert.equal(state.required, true);
	assert.equal(state.buttonText, 'Choose audio file');
	assert.equal(state.buttonFor, 'audioFile');
	assert.equal(state.filename, uploadFilename);
	assert.equal(state.filenameTitle, uploadFilename);
	assert.deepEqual(state.filenameStyle, {
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap'
	});
	assert.equal(state.selectedName, uploadFilename);
	assert.equal(state.formName, uploadFilename);
	assert.equal(state.formSize, state.selectedSize);
	assert.equal(state.coverUsesPicker, true);
	assert.equal(state.coverVisibleLabel, 'Choose image');
}

async function setAuthenticatedCookie(cdp, name, value, baseUrl) {
	const cookie = await cdp.command('Network.setCookie', {
		name,
		value,
		url: baseUrl,
		httpOnly: true,
		sameSite: 'Lax'
	});
	assert.equal(cookie.success, true);
}

const config = readMongoConfig(process.env);
const databaseName = ownedDatabaseName(config.testDatabaseName, config.databaseName);
const manager = new MongoClientManager(config);
let databaseAuthorizedForCleanup = false;
let initialTestDatabases;
let realFingerprint;
let realCounter;
let temporaryRoot;
let uploadFixturePath;
let uploadFixtureFilename;
let app;
let browser;
let browserDiagnostics = '';
let cdp;
let primaryFailure;
let overallTimedOut = false;
const cleanupFailures = [];
const overallTimer = setTimeout(() => {
	overallTimedOut = true;
	if (browser?.exitCode === null) browser.kill('SIGKILL');
	if (app?.exitCode === null) app.kill('SIGKILL');
}, OVERALL_TIMEOUT_MS);
overallTimer.unref();

try {
	const client = await manager.connect();
	const listed = await client.db('admin').admin().listDatabases({ nameOnly: true });
	initialTestDatabases = listed.databases
		.map(({ name }) => name)
		.filter((name) => name.startsWith(MONGODB_TEST_DATABASE_PREFIX))
		.sort();
	assert.equal(initialTestDatabases.includes(databaseName), false);
	databaseAuthorizedForCleanup = true;
	const realCollections = getMongoCollections(client.db(config.databaseName));
	realFingerprint = await safeMongoAggregateFingerprint(realCollections);
	realCounter = await realCollections.counters.findOne(
		{ _id: TRACK_PUBLIC_ID_COUNTER },
		{ projection: { _id: 0, value: 1 }, timeoutMS: 5_000 }
	);

	temporaryRoot = await mkdtemp(join(resolve(tmpdir()), TEMP_PREFIX));
	assert.ok(isOwnedTemporaryRoot(temporaryRoot));
	const audioRoot = join(temporaryRoot, 'audio');
	const coverRoot = join(audioRoot, 'covers');
	const playlistImageRoot = join(temporaryRoot, 'playlist-images');
	const browserProfile = join(temporaryRoot, 'browser-profile');
	uploadFixtureFilename = 'synthetic-audio-file-with-a-very-long-name-for-narrow-phone-layout-verification.mp3';
	uploadFixturePath = join(temporaryRoot, uploadFixtureFilename);
	await mkdir(coverRoot, { recursive: true });
	await mkdir(playlistImageRoot);
	const audioStorageKeys = [`${randomUUID()}.mp3`, `${randomUUID()}.mp3`, `${randomUUID()}.mp3`];
	const coverStorageKey = `${randomUUID()}.png`;
	const playlistImageStorageKey = `${randomUUID()}.png`;
	await Promise.all([
		...audioStorageKeys.map((storageKey) => writeFile(join(audioRoot, storageKey), SYNTHETIC_AUDIO)),
		writeFile(join(coverRoot, coverStorageKey), SYNTHETIC_PNG),
		writeFile(join(playlistImageRoot, playlistImageStorageKey), SYNTHETIC_PNG),
		writeFile(uploadFixturePath, SYNTHETIC_AUDIO)
	]);

	const collections = getMongoCollections(client.db(databaseName));
	await ensureMongoIndexes(collections, { maxTimeMS: 8_000 });
	await collections.counters.insertOne({ _id: TRACK_PUBLIC_ID_COUNTER, value: 3 });
	const now = new Date('2026-08-03T12:00:00.000Z');
	const ownerId = randomUUID();
	const token = randomBytes(32).toString('base64url');
	await collections.users.insertOne({
		_id: ownerId,
		username: 'synthetic_visual_owner',
		email: 'synthetic-visual@example.invalid',
		passwordHash: 'synthetic-only',
		createdAt: now,
		updatedAt: now
	});
	await collections.sessions.insertOne({
		_id: randomUUID(),
		tokenHash: hashSessionToken(token),
		userId: ownerId,
		expiresAt: new Date(Date.now() + 60 * 60_000),
		createdAt: now
	});
	const trackIds = [randomUUID(), randomUUID(), randomUUID()];
	await collections.tracks.insertMany(trackIds.map((id, index) => ({
		_id: id,
		publicId: index + 1,
		ownerId,
		title: index === 0
			? 'Synthetic covered track with an intentionally long responsive title'
			: index === 1
				? 'Synthetic fallback track'
				: 'Private synthetic owner track',
		artist: index === 0
			? 'Synthetic visual artist with a long display name'
			: 'Synthetic visual artist',
		bpm: index === 0 ? 124 : index === 1 ? 96 : null,
		musicalKey: index === 0 ? 'A minor' : null,
		genre: index === 0 ? 'Electronic' : null,
		description: index === 0 ? 'Synthetic visual verification fixture.' : null,
		originalFilename: `synthetic-${index + 1}.mp3`,
		storageKey: audioStorageKeys[index],
		mimeType: 'audio/mpeg',
		fileSizeBytes: SYNTHETIC_AUDIO.byteLength,
		durationMs: null,
		coverImage: index === 0
			? {
					storageKey: coverStorageKey,
					mimeType: 'image/png',
					byteSize: SYNTHETIC_PNG.byteLength
				}
			: null,
		visibility: index < 2 ? 'public' : 'private',
		createdAt: new Date(now.getTime() + index),
		updatedAt: new Date(now.getTime() + index)
	})));
	const playlistId = randomUUID();
	const playlistPublicId = randomBytes(18).toString('base64url');
	await collections.playlists.insertMany([
		{
			_id: playlistId,
			publicId: playlistPublicId,
			ownerId,
			name: 'Synthetic visual playlist with a deliberately long responsive name',
			description: 'Owned visual verification fixture.',
			image: {
				storageKey: playlistImageStorageKey,
				mimeType: 'image/png',
				byteSize: SYNTHETIC_PNG.byteLength
			},
			createdAt: now,
			updatedAt: now
		},
		{
			_id: randomUUID(),
			publicId: randomBytes(18).toString('base64url'),
			ownerId,
			name: 'Synthetic fallback playlist',
			description: null,
			image: null,
			createdAt: now,
			updatedAt: now
		}
	]);
	await collections.playlistItems.insertMany(trackIds.slice(0, 2).map((trackId, index) => ({
		_id: randomUUID(),
		playlistId,
		trackId,
		addedAt: new Date(now.getTime() + index)
	})));

	const appPort = await reservePort();
	const debugPort = await reservePort();
	const baseUrl = `http://127.0.0.1:${appPort}`;
	const cookieName = `visual_view_${randomBytes(4).toString('hex')}`;
	app = spawn(
		process.execPath,
		[
			resolve('node_modules/vite/bin/vite.js'),
			'dev',
			'--host',
			'127.0.0.1',
			'--port',
			String(appPort),
			'--strictPort'
		],
		{
			cwd: resolve('.'),
			env: createSyntheticApplicationEnvironment({
				AUDIO_STORAGE_PATH: audioRoot,
				PLAYLIST_IMAGE_STORAGE_PATH: playlistImageRoot,
				SESSION_COOKIE_NAME: cookieName,
				MONGODB_URI: config.uri,
				MONGODB_DB_NAME: databaseName,
				MONGODB_TEST_DB_NAME: config.testDatabaseName
			}),
			stdio: 'ignore',
			windowsHide: true
		}
	);
	await waitForApplication(baseUrl, app);
	console.log('VISUAL_VIEWPORT_APP_READY=1');

	browser = spawn(
		browserBinary(),
		[
			'--headless=new',
			'--no-sandbox',
			'--disable-gpu',
			'--disable-gpu-sandbox',
			'--disable-extensions',
			'--disable-background-networking',
			'--no-first-run',
			'--no-default-browser-check',
			`--remote-debugging-port=${debugPort}`,
			`--user-data-dir=${browserProfile}`,
			'about:blank'
		],
		{ stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true }
	);
	browser.stderr?.setEncoding('utf8');
	browser.stderr?.on('data', (chunk) => {
		browserDiagnostics = `${browserDiagnostics}${chunk}`.slice(-4_000);
	});
	cdp = await connectCdp(await waitForBrowser(debugPort, browser));
	console.log('VISUAL_VIEWPORT_BROWSER_READY=1');
	await cdp.command('Page.enable');
	await cdp.command('Runtime.enable');
	await cdp.command('Network.enable');
	await cdp.command('Page.addScriptToEvaluateOnNewDocument', {
		source: `window.__audioLibraryThemeAtFirstPaint = null; new PerformanceObserver((list, observer) => { if (list.getEntries().some((entry) => entry.name === 'first-paint')) { window.__audioLibraryThemeAtFirstPaint = document.documentElement.dataset.theme ?? null; observer.disconnect(); } }).observe({ type: 'paint', buffered: true });`
	});

	for (const [width, height] of VIEWPORTS) {
		assert.equal(overallTimedOut, false, 'Visual viewport verification exceeded its overall timeout.');
		await cdp.command('Emulation.setDeviceMetricsOverride', {
			width,
			height,
			deviceScaleFactor: 1,
			mobile: width <= 390
		});
		await cdp.command('Network.clearBrowserCookies');

		await navigate(cdp, `${baseUrl}/`, '.hero');
		await evaluate(cdp, `localStorage.removeItem(${JSON.stringify(THEME_STORAGE_KEY)})`);
		await reload(cdp, '.hero');
		assertThemeState(await currentThemeState(cdp), 'dark', null);
		await saveThemeAndReload(cdp, 'light', '.hero');
		assertCommonPageState(await commonPageState(cdp), width, 'light');
		await navigate(cdp, `${baseUrl}/tracks`, '.track-filters');
		assertCommonPageState(await commonPageState(cdp), width, 'light');
		await reload(cdp, '.track-filters');
		assertCommonPageState(await commonPageState(cdp), width, 'light');
		await evaluate(cdp, `document.querySelector('.theme-toggle').click()`);
		assertThemeState(await currentThemeState(cdp), 'dark', 'dark', 'light');
		await reload(cdp, '.track-filters');
		assertCommonPageState(await commonPageState(cdp), width, 'dark');
		await evaluate(
			cdp,
			`localStorage.setItem(${JSON.stringify(THEME_STORAGE_KEY)}, 'invalid-theme')`
		);
		await reload(cdp, '.track-filters');
		assertThemeState(await currentThemeState(cdp), 'dark', 'invalid-theme');

		for (const theme of THEMES) {
			await cdp.command('Network.clearBrowserCookies');
			await navigate(cdp, `${baseUrl}/`, '.hero');
			await saveThemeAndReload(cdp, theme, '.hero');
			assertCommonPageState(await commonPageState(cdp), width, theme);
		const homeState = await evaluate(cdp, `(() => {
			const cards = [...document.querySelectorAll('.feature-card')];
			return {
				heading: document.querySelector('.hero h1')?.textContent.trim(),
				waveformHidden: document.querySelector('.audio-waveform')?.getAttribute('aria-hidden'),
				loggedOutPlaylists: [...document.querySelectorAll('a[href="/playlists"]')].length,
				browseCtas: document.querySelectorAll('.hero__actions a[href="/tracks"]').length,
				loginCtas: document.querySelectorAll('.hero__actions a[href="/login"]').length,
				registerCtas: document.querySelectorAll('.hero__actions a[href="/register"]').length,
				workflowCards: cards.length,
				workflowIcons: cards.filter((card) => card.querySelector('.feature-icon svg')).length,
				workflowClipped: cards.some((card) => card.scrollWidth > card.clientWidth + 1),
				privacyNote: Boolean(document.querySelector('.library-note'))
			};
		})()`);
		assert.ok(homeState.heading.includes('Discover community audio'));
		assert.equal(homeState.waveformHidden, 'true');
		assert.equal(homeState.loggedOutPlaylists, 0);
		assert.equal(homeState.browseCtas, 1);
		assert.equal(homeState.loginCtas, 1);
		assert.equal(homeState.registerCtas, 1);
		assert.equal(homeState.workflowCards, 5);
		assert.equal(homeState.workflowIcons, 5);
		assert.equal(homeState.workflowClipped, false);
		assert.equal(homeState.privacyNote, true);
		await verifyVisibleFocus(cdp);
		await cdp.command('Emulation.setEmulatedMedia', {
			features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
		});
		const reducedMotion = await evaluate(cdp, `(() => {
			const bars = document.querySelector('.audio-waveform__bars');
			const particles = document.querySelector('.audio-waveform__particles');
			return [getComputedStyle(bars).animationName, getComputedStyle(particles).animationName];
		})()`);
		assert.deepEqual(reducedMotion, ['none', 'none']);
		await cdp.command('Emulation.setEmulatedMedia', {
			features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }]
		});

		await navigate(cdp, `${baseUrl}/login`, '.auth-card');
		assertCommonPageState(await commonPageState(cdp), width, theme);
		const loginControls = await evaluate(cdp, `(() => [...document.querySelectorAll('.auth-card input:not([type="hidden"])')].every((input) => {
			const style = getComputedStyle(input);
			return input.getBoundingClientRect().width > 0 && style.color !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'rgba(0, 0, 0, 0)';
		}))()`);
		assert.equal(loginControls, true);
		await navigate(cdp, `${baseUrl}/register`, '.auth-card');
		assertCommonPageState(await commonPageState(cdp), width, theme);

		await navigate(cdp, `${baseUrl}/tracks`, '.track-filters');
		assertCommonPageState(await commonPageState(cdp), width, theme);
		await verifyFilterLayout(cdp, width);
		const browseState = await evaluate(cdp, `(() => {
			const cards = [...document.querySelectorAll('.track-card')];
			const rects = cards.map((card) => card.getBoundingClientRect());
			const filter = document.querySelector('.track-filters');
			const filterStyle = getComputedStyle(filter);
			return {
				heading: document.querySelector('.tracks-hero h1')?.textContent.trim(),
				heroWaveform: Boolean(document.querySelector('.tracks-hero .audio-waveform')),
				filterBackground: filterStyle.backgroundColor,
				filterBorder: filterStyle.borderTopColor,
				filterNames: [...filter.querySelectorAll('input[name], select[name]')].map((control) => control.name).sort(),
				applyVisible: document.querySelector('.track-filters__actions .primary-button')?.getBoundingClientRect().width > 0,
				cardCount: cards.length,
				coveredRows: cards.filter((card) => card.querySelector('.track-cover img')).length,
				fallbackRows: cards.filter((card) => card.querySelector('.track-cover__fallback')).length,
				overflow: cards.some((card) => card.scrollWidth > card.clientWidth + 1),
				overlap: rects.some((rect, index) => index > 0 && rect.top < rects[index - 1].bottom - 1),
				longIdentitySafe: cards.every((card) => {
					const identity = card.querySelector('.track-card__identity');
					return identity.scrollWidth <= identity.clientWidth + 1;
				})
			};
		})()`);
		assert.ok(browseState.heading.includes('Find the perfect track'));
		assert.equal(browseState.heroWaveform, false);
		assert.notEqual(browseState.filterBackground, 'rgba(0, 0, 0, 0)');
		assert.notEqual(browseState.filterBorder, 'rgba(0, 0, 0, 0)');
		assert.deepEqual(browseState.filterNames, ['bpmMax', 'bpmMin', 'genre', 'musicalKey', 'q', 'sort']);
		assert.equal(browseState.applyVisible, true);
		assert.equal(browseState.cardCount, 2);
		assert.equal(browseState.coveredRows, 1);
		assert.equal(browseState.fallbackRows, 1);
		assert.equal(browseState.overflow, false);
		assert.equal(browseState.overlap, false);
		assert.equal(browseState.longIdentitySafe, true);
		await verifyNarrowBrowseLayout(cdp, width);

		await navigate(cdp, `${baseUrl}/tracks/1`, '.track-detail');
		assertCommonPageState(await commonPageState(cdp), width, theme);
		const detailState = await evaluate(cdp, `(() => ({
			cover: Boolean(document.querySelector('.track-detail .track-cover img')),
			play: Boolean(document.querySelector('.track-detail [aria-label^="Play "]')),
			download: Boolean(document.querySelector('.track-detail a[href$="/download"]')),
			overflow: document.querySelector('.track-detail').scrollWidth > document.querySelector('.track-detail').clientWidth + 1
		}))()`);
		assert.deepEqual(detailState, { cover: true, play: true, download: true, overflow: false });

		await setAuthenticatedCookie(cdp, cookieName, token, baseUrl);
		await navigate(cdp, `${baseUrl}/`, '.hero');
		assertCommonPageState(await commonPageState(cdp), width, theme);
		const authNavigation = await evaluate(
			cdp,
			`[...document.querySelectorAll('a[href="/playlists"]')].length`
		);
		assert.ok(authNavigation >= 2);

		await navigate(cdp, `${baseUrl}/tracks`, '.track-card');
		const dialogState = await openAndInspectPlaylistDialog(cdp);
		assert.equal(dialogState.open, true);
		assert.notEqual(dialogState.background, 'rgba(0, 0, 0, 0)');
		assert.notEqual(dialogState.color, 'rgba(0, 0, 0, 0)');
		await activateAndWaitForPlayer(cdp);
		const playerState = await evaluate(cdp, `(() => {
			const player = document.querySelector('.global-player');
			const rect = player.getBoundingClientRect();
			const shell = document.querySelector('.site-shell');
			return {
				left: rect.left,
				right: rect.right,
				clientWidth: document.documentElement.clientWidth,
				bottom: rect.bottom,
				height: rect.height,
				close: document.querySelectorAll('[aria-label="Close audio player"]').length,
				cover: Boolean(player.querySelector('.track-cover')),
				toggle: Boolean(player.querySelector('.global-player__toggle')),
				seek: Boolean(player.querySelector('input[aria-label^="Seek "]')),
				volume: Boolean(player.querySelector('input[aria-label="Volume"]')),
				shellPaddingBottom: parseFloat(getComputedStyle(shell).paddingBottom),
				color: getComputedStyle(player).color,
				backgroundImage: getComputedStyle(player).backgroundImage
			};
		})()`);
		assert.ok(Math.abs(playerState.left) <= 0.5);
		assert.ok(Math.abs(playerState.right - playerState.clientWidth) <= 0.5);
		assert.ok(Math.abs(playerState.bottom - height) <= 0.5);
		assert.equal(playerState.close, 0);
		assert.equal(playerState.cover, true);
		assert.equal(playerState.toggle, true);
		assert.equal(playerState.seek, true);
		assert.equal(playerState.volume, true);
		assert.notEqual(playerState.color, 'rgba(0, 0, 0, 0)');
		assert.notEqual(playerState.backgroundImage, 'none');
		assert.ok(playerState.shellPaddingBottom >= playerState.height - 2);
		await verifyUploadFilePicker(cdp, baseUrl, width, theme, uploadFixturePath, uploadFixtureFilename);

		await navigate(cdp, `${baseUrl}/my-tracks`, '.owner-track-grid');
		assertCommonPageState(await commonPageState(cdp), width, theme);
		const ownerState = await evaluate(cdp, `(() => {
			const cards = [...document.querySelectorAll('.owner-track-card')];
			return {
				count: cards.length,
				covered: cards.filter((card) => card.querySelector('.track-cover img')).length,
				fallback: cards.filter((card) => card.querySelector('.track-cover__fallback')).length,
				overflow: cards.some((card) => card.scrollWidth > card.clientWidth + 1)
			};
		})()`);
		assert.equal(ownerState.count, 3);
		assert.equal(ownerState.covered, 1);
		assert.equal(ownerState.fallback, 2);
		assert.equal(ownerState.overflow, false);

		await navigate(cdp, `${baseUrl}/playlists`, '.playlist-card');
		assertCommonPageState(await commonPageState(cdp), width, theme);
		const playlistImageDecoded = await evaluate(cdp, `(async () => {
			const image = document.querySelector('.playlist-card .playlist-artwork img');
			if (!image) return false;
			try {
				await Promise.race([
					image.decode(),
					new Promise((_, reject) => setTimeout(() => reject(new Error('decode timeout')), 5_000))
				]);
			} catch {}
			return image.complete && image.naturalWidth > 0;
		})()`);
		assert.equal(playlistImageDecoded, true);
		const playlistLibraryState = await evaluate(cdp, `(() => {
			const images = [...document.querySelectorAll('.playlist-card .playlist-artwork img')];
			return {
				cards: document.querySelectorAll('.playlist-card').length,
				images: images.length,
				decodedImages: images.filter((image) => image.complete && image.naturalWidth > 0).length,
				fallbacks: document.querySelectorAll('.playlist-card .playlist-artwork__fallback').length
			};
		})()`);
		assert.deepEqual(playlistLibraryState, { cards: 2, images: 1, decodedImages: 1, fallbacks: 1 });
		await navigate(cdp, `${baseUrl}/playlists/${playlistPublicId}`, '.playlist-detail-page');
		assertCommonPageState(await commonPageState(cdp), width, theme);
		const playlistState = await evaluate(cdp, `(() => {
			const rows = [...document.querySelectorAll('.playlist-tracks li')];
			return {
				count: rows.length,
				overflow: rows.some((row) => row.scrollWidth > row.clientWidth + 1),
				image: Boolean(document.querySelector('.playlist-detail-heading .playlist-artwork img'))
			};
		})()`);
		assert.equal(playlistState.count, 2);
		assert.equal(playlistState.overflow, false);
		assert.equal(playlistState.image, true);

		const screenshot = await cdp.command('Page.captureScreenshot', {
			format: 'png',
			captureBeyondViewport: false
		});
		assert.ok(screenshot.data.length > 1_000);
			console.log(`THEME_VIEWPORT_PASS=${theme}:${width}x${height}`);
		}
		console.log(`THEME_VIEWPORT_BOTH_PASS=${width}x${height}`);
	}

	console.log(
		`THEME_VIEWPORTS_VERIFIED=${VIEWPORTS.map(([width, height]) => `${width}x${height}`).join(',')};THEMES=${THEMES.join(',')}`
	);
} catch (error) {
	if (overallTimedOut) {
		primaryFailure = new Error('Visual viewport verification exceeded its bounded overall timeout.');
	} else {
		if (browser?.exitCode !== null || browserDiagnostics) {
			error.message = `${error.message} Browser exit code: ${browser?.exitCode ?? 'running'}.${browserDiagnostics ? ` Diagnostics: ${browserDiagnostics.trim()}` : ''}`;
		}
		primaryFailure = error;
	}
} finally {
	clearTimeout(overallTimer);
	try {
		cdp?.close();
		await stopChild(browser);
		await stopChild(app);
	} catch (error) {
		cleanupFailures.push(error);
	}
	try {
		const client = await manager.connect();
		const listed = await client.db('admin').admin().listDatabases({ nameOnly: true });
		if (
			databaseAuthorizedForCleanup &&
			listed.databases.some(({ name }) => name === databaseName)
		) {
			await client.db(databaseName).dropDatabase({ timeoutMS: 10_000 });
		}
		const after = (await client.db('admin').admin().listDatabases({ nameOnly: true }))
			.databases.map(({ name }) => name)
			.filter((name) => name.startsWith(MONGODB_TEST_DATABASE_PREFIX))
			.sort();
		assert.deepEqual(after, initialTestDatabases);
		const realCollections = getMongoCollections(client.db(config.databaseName));
		assert.equal(await safeMongoAggregateFingerprint(realCollections), realFingerprint);
		assert.deepEqual(
			await realCollections.counters.findOne(
				{ _id: TRACK_PUBLIC_ID_COUNTER },
				{ projection: { _id: 0, value: 1 }, timeoutMS: 5_000 }
			),
			realCounter
		);
	} catch (error) {
		cleanupFailures.push(error);
	}
	await manager.close(true).catch((error) => cleanupFailures.push(error));
	if (temporaryRoot && existsSync(temporaryRoot)) {
		try {
			assert.ok(isOwnedTemporaryRoot(temporaryRoot));
			await rm(temporaryRoot, {
				recursive: true,
				force: true,
				maxRetries: 5,
				retryDelay: 200
			});
			assert.equal(existsSync(temporaryRoot), false);
		} catch (error) {
			cleanupFailures.push(error);
		}
	}
}

if (primaryFailure && cleanupFailures.length > 0) {
	throw new AggregateError(
		[primaryFailure, ...cleanupFailures],
		'Visual viewport verification and cleanup failed.'
	);
}
if (primaryFailure) throw primaryFailure;
if (cleanupFailures.length > 0) {
	throw new AggregateError(cleanupFailures, 'Visual viewport cleanup failed.');
}

console.log('VISUAL_VIEWPORT_CLEANUP_PASSED=1');
