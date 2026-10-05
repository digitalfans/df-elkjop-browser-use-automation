// The launcher the developer double-clicks on the Copywriter's Mac, and updates by replacing the app
// folder. The download of a real Node.js is in test/slow/, outside the default run.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import type net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import {
  copyApp, freePort, launchChrome, runLauncher, startRecorder, waitFor, type Launcher, type Recorder,
} from './harness.ts';

let cleanup: (() => Promise<unknown>)[] = [];

afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

async function tempDir(prefix: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  cleanup.push(() => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  return dir;
}

async function app() {
  const dir = await copyApp();
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function launch(appDir: string, env: Record<string, string>): Launcher {
  const l = runLauncher(appDir, env);
  cleanup.push(() => l.stop());
  return l;
}

// A Node.js download mirror that serves `files` by name, and records what was asked for.
async function mirror(files: (name: string) => string | Buffer | null) {
  const requested: string[] = [];
  const server = http.createServer((req, res) => {
    const name = path.basename(req.url ?? '');
    requested.push(req.url ?? '');
    const body = files(name);
    if (body === null) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200).end(body);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  cleanup.push(() => new Promise((r) => server.close(r)));
  return { url: `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`, requested };
}

const answers = async (port: number) => Boolean((await fetch(`http://127.0.0.1:${port}/api/state`).catch(() => null))?.ok);

test('a Node.js download whose checksum does not match aborts without installing anything', { timeout: 60_000 }, async () => {
  const dir = await app();
  const data = await tempDir('recorder-data-');
  const tampered = Buffer.from('not the Node.js the checksums describe');
  const m = await mirror((name) => {
    if (name.endsWith('.tar.gz')) return tampered;
    if (name === 'SHASUMS256.txt') {
      // The official list, with a hash for every Mac build that is not the one served.
      const version = m.requested.find((u) => u.endsWith('.tar.gz'))!.split('/').at(-2);
      return ['arm64', 'x64'].map((a) => `${'0'.repeat(64)}  node-${version}-darwin-${a}.tar.gz\n`).join('');
    }
    return null;
  });
  const port = await freePort();
  const l = launch(dir, {
    RECORDER_PORT: String(port), RECORDER_NODE_MIRROR: m.url, RECORDER_NO_OPEN: '1',
    RECORDINGS_DIR: path.join(data, 'recordings'), PROFILES_DIR: path.join(data, 'profiles'),
  });

  const code = await l.exited;
  assert.notEqual(code, 0, l.output());
  assert.match(l.output(), /checksum/i);
  // The build for this Mac's architecture, then the official checksums.
  const arch = os.arch() === 'arm64' ? 'arm64' : 'x64';
  assert.match(m.requested[0], new RegExp(`^/v22\\.\\d+\\.\\d+/node-v22\\.\\d+\\.\\d+-darwin-${arch}\\.tar\\.gz$`));
  assert.ok(m.requested.some((u) => u.endsWith('/SHASUMS256.txt')));

  // Nothing installed, nothing left behind, nothing started.
  assert.deepEqual(fs.readdirSync(dir).sort(), ['Start Recorder.command', 'package-lock.json', 'package.json', 'public', 'src']);
  assert.equal(await answers(port), false);
  assert.deepEqual(fs.readdirSync(data), [], 'no data folders created');
});

test('a Node.js download that fails aborts without installing anything', { timeout: 60_000 }, async () => {
  const dir = await app();
  const m = await mirror(() => null);
  const l = launch(dir, { RECORDER_PORT: String(await freePort()), RECORDER_NODE_MIRROR: m.url, RECORDER_NO_OPEN: '1' });
  assert.notEqual(await l.exited, 0, l.output());
  assert.match(l.output(), /download/i);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['Start Recorder.command', 'package-lock.json', 'package.json', 'public', 'src']);
});

test('running the launcher while the app runs only opens the page', { timeout: 60_000 }, async () => {
  const r: Recorder = await startRecorder();
  cleanup.push(() => r.close());
  const port = new URL(r.url).port;
  const dir = await app();
  // Any download would fail, and there is no Node.js on the PATH: it must not need either.
  const m = await mirror(() => null);
  const l = launch(dir, { RECORDER_PORT: port, RECORDER_NODE_MIRROR: m.url, RECORDER_NO_OPEN: '1' });

  assert.equal(await l.exited, 0, l.output());
  assert.match(l.output(), /already running/i);
  assert.ok(l.output().includes(`http://localhost:${port}`), l.output());
  assert.deepEqual(m.requested, []);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['Start Recorder.command', 'package-lock.json', 'package.json', 'public', 'src']);
  assert.equal((await r.api('GET', '/api/state')).status, 200, 'the running app is untouched');
});

test('the launcher uses a recent enough system Node.js and starts the app on the given port and data folders', { timeout: 120_000 }, async () => {
  const dir = await app();
  // The app's dependencies as the launcher would install them, so this needs no network.
  fs.symlinkSync(path.resolve(import.meta.dirname, '..', 'node_modules'), path.join(dir, 'node_modules'));
  const data = await tempDir('recorder-data-');
  const m = await mirror(() => null);
  const port = await freePort();
  const l = launch(dir, {
    PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
    RECORDER_PORT: String(port), RECORDER_NODE_MIRROR: m.url, RECORDER_NO_OPEN: '1',
    RECORDINGS_DIR: path.join(data, 'recordings'), PROFILES_DIR: path.join(data, 'profiles'),
  });
  await waitFor('the app to answer', async () => {
    if (await answers(port)) return true;
    const code = await Promise.race([l.exited, null]);
    if (code !== null) throw new Error(`The launcher exited (${code}):\n${l.output()}`);
    return false;
  }, 30_000);

  assert.deepEqual(m.requested, [], 'no download');
  assert.equal(fs.existsSync(path.join(dir, '.runtime')), false);
  const state = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json();
  assert.equal(state.recordingsDir, path.join(data, 'recordings'));
  assert.equal(state.profilesDir, path.join(data, 'profiles'));
  const h = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
  assert.ok(h.checks.find((c: any) => c.id === 'node').detail.includes(process.execPath));
});

test('replacing the app folder with a new version keeps Tickets, Recordings, Work Profiles and settings', { timeout: 120_000 }, async () => {
  const data = await tempDir('recorder-data-');
  const synced = await tempDir('recorder-export-');
  const env = {
    RECORDINGS_DIR: path.join(data, 'recordings'), PROFILES_DIR: path.join(data, 'profiles'), TRASH_DIR: path.join(data, 'Trash'),
  };

  // This version: a Work Profile, settings and a Ticket with a Recording.
  const before = await startRecorder({ env });
  cleanup.push(() => before.close());
  const { body: profile } = await before.api('POST', '/api/profiles', { name: 'elkjop' });
  assert.equal((await before.api('POST', '/api/settings', { exportDir: synced, diskLimitGB: 2 })).status, 200);
  assert.equal((await before.api('POST', '/api/tickets', { ticket: 'PM-1' })).status, 200);
  assert.equal((await before.api('POST', '/api/tickets/briefing', { ticket: 'PM-1', briefing: 'Localize the LP' })).status, 200);
  const chrome = await launchChrome(profile);
  cleanup.push(() => chrome.close());
  assert.equal((await before.api('POST', '/api/start', { ticket: 'PM-1', profile: 'elkjop' })).status, 200);
  const page = await chrome.context.newPage();
  await page.goto(`${before.url}/demo`);
  await waitFor('the navigation', () => before.timeline('PM-1').some((e) => e.type === 'navigate'));
  assert.equal((await before.api('POST', '/api/stop')).status, 200);
  const tickets = (await before.api('GET', '/api/tickets')).body.tickets;
  const timeline = before.timeline('PM-1');
  await chrome.close();
  await before.close();

  // The new version: a fresh app folder from a new zip, started on the same Mac.
  const next = await app();
  const manifest = JSON.parse(fs.readFileSync(path.join(next, 'package.json'), 'utf8'));
  fs.writeFileSync(path.join(next, 'package.json'), JSON.stringify({ ...manifest, version: '99.0.0' }, null, 2));
  const after = await startRecorder({ appDir: next, env });
  cleanup.push(() => after.close());

  assert.equal((await after.api('GET', '/api/health')).body.version, '99.0.0', 'the new version runs');
  assert.deepEqual((await after.api('GET', '/api/tickets')).body.tickets, tickets);
  assert.deepEqual(after.timeline('PM-1'), timeline);
  const session = after.ticketJson('PM-1').sessions[0];
  assert.equal(session.profile, 'elkjop');
  assert.ok(fs.existsSync(path.join(env.RECORDINGS_DIR, 'PM-1', 'traces', 'session-1.zip')));
  assert.ok(fs.existsSync(path.join(env.RECORDINGS_DIR, 'PM-1.zip')));
  assert.deepEqual((await after.api('GET', '/api/profiles')).body.map((p: any) => [p.name, p.port]), [['elkjop', profile.port]]);
  const settings = (await after.api('GET', '/api/settings')).body;
  assert.equal(settings.exportDir, synced);
  assert.equal(settings.diskLimitGB, 2);
});
