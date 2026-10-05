// The setup checklist: what a Mac needs before it can record, how to fix each item, and the app version.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { copyApp, launchChrome, startRecorder, waitFor, type Chrome, type Recorder, type RecorderOptions } from './harness.ts';

const APP_DIR = path.resolve(import.meta.dirname, '..');
const VERSION = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf8')).version;

let recorder: Recorder | undefined;
let cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
  await recorder?.close();
  recorder = undefined;
});

async function start(options?: RecorderOptions) {
  recorder = await startRecorder(options);
  return recorder;
}

async function health(r: Recorder) {
  const res = await r.api('GET', '/api/health');
  assert.equal(res.status, 200, res.body.error);
  return res.body;
}

const check = (h: any, id: string) => {
  const c = h.checks.find((x: any) => x.id === id);
  assert.ok(c, `a ${id} check`);
  return c;
};

const failing = (h: any) => h.checks.filter((c: any) => !c.ok).map((c: any) => c.id);

async function tempDir(prefix: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('a fresh Mac lacks only a Work Profile; Create profile makes it healthy', async () => {
  const r = await start();
  let h = await health(r);
  assert.equal(h.version, VERSION);
  assert.deepEqual(h.checks.map((c: any) => c.id), ['node', 'playwright', 'chrome', 'zip', 'recordings', 'profile', 'export']);
  for (const c of h.checks) {
    assert.equal(typeof c.label, 'string');
    assert.equal(typeof c.detail, 'string');
    assert.equal(typeof c.help, 'string', `${c.id} says what it is for`);
    assert.equal(c.required, c.id !== 'export');
  }

  assert.equal(h.healthy, false);
  assert.deepEqual(failing(h), ['profile', 'export']);
  assert.equal(check(h, 'profile').action, 'create-profile');

  // Versions and paths, so a screenshot is enough to diagnose a problem.
  assert.ok(check(h, 'node').detail.includes(process.version) && check(h, 'node').detail.includes(process.execPath));
  const chrome = check(h, 'chrome');
  assert.match(chrome.detail, /^version \d+\.\d+\.\d+\.\d+ at /);
  assert.ok(chrome.detail.includes('Google Chrome'), chrome.detail);
  assert.match(check(h, 'playwright').detail, /^version \d+\.\d+/);
  assert.equal(check(h, 'playwright').action, undefined);
  assert.match(check(h, 'zip').detail, /zip/);
  // The recordings folder is created if it is missing.
  assert.ok(check(h, 'recordings').detail.includes(r.recordingsDir));
  assert.ok(fs.statSync(r.recordingsDir).isDirectory());

  const created = await r.api('POST', '/api/profiles', { name: 'elkjop' });
  assert.equal(created.status, 200, created.body.error);
  h = await health(r);
  assert.equal(h.healthy, true, 'the export folder is shown but not required');
  assert.match(check(h, 'profile').detail, /elkjop/);
  assert.equal(check(h, 'profile').action, undefined);
  assert.equal(check(h, 'export').ok, false);

  // Once set, the export folder is shown as ok; it never changed `healthy`.
  const synced = await tempDir('recorder-export-');
  assert.equal((await r.api('POST', '/api/settings', { exportDir: synced })).status, 200);
  h = await health(r);
  assert.equal(check(h, 'export').ok, true);
  assert.ok(check(h, 'export').detail.includes(synced));
  assert.equal(h.healthy, true);
});

test('a missing Chrome is not healthy and says how to install it by hand', async () => {
  const r = await start({ env: { CHROME_PATH: '/nonexistent/Google Chrome.app/Contents/MacOS/Google Chrome' } });
  assert.equal((await r.api('POST', '/api/profiles', { name: 'elkjop' })).status, 200);
  const h = await health(r);
  assert.equal(h.healthy, false);
  assert.deepEqual(failing(h), ['chrome', 'export']);
  assert.match(check(h, 'chrome').detail, /https:\/\/www\.google\.com\/chrome/);
  assert.equal(check(h, 'chrome').action, undefined, 'nothing the app can do for her');
});

test('a recordings folder that cannot be written is not healthy', async () => {
  const blocked = await tempDir('recorder-blocked-');
  fs.chmodSync(blocked, 0o555);
  cleanup.push(async () => fs.chmodSync(blocked, 0o755));
  const r = await start({ env: { RECORDINGS_DIR: path.join(blocked, 'recordings') } });
  assert.equal((await r.api('POST', '/api/profiles', { name: 'elkjop' })).status, 200);
  const h = await health(r);
  assert.equal(h.healthy, false);
  assert.deepEqual(failing(h), ['recordings', 'export']);
  assert.ok(check(h, 'recordings').detail.includes(path.join(blocked, 'recordings')));
});

test('without Playwright the server starts, and Install fixes it without a restart', { timeout: 300_000 }, async () => {
  const app = await copyApp();
  cleanup.push(() => rm(app, { recursive: true, force: true }));
  const r = await start({ appDir: app });

  const profile = (await r.api('POST', '/api/profiles', { name: 'elkjop' })).body;
  let h = await health(r);
  assert.equal(h.healthy, false);
  assert.deepEqual(failing(h), ['playwright', 'export']);
  assert.equal(check(h, 'playwright').action, 'install');

  // Recording needs it, and says where to get it.
  const chrome: Chrome = await launchChrome(profile);
  cleanup.push(() => chrome.close());
  assert.equal((await r.api('POST', '/api/tickets', { ticket: 'PM-1' })).status, 200);
  const refused = await r.api('POST', '/api/start', { ticket: 'PM-1', profile: 'elkjop' });
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /Playwright is not installed/);

  const installed = await r.api('POST', '/api/setup/install');
  assert.equal(installed.status, 200, installed.body.error);
  assert.equal(typeof installed.body.log, 'string');
  // Only the runtime dependency, and no browser download: she records in her own Google Chrome.
  assert.ok(fs.existsSync(path.join(app, 'node_modules', 'playwright', 'package.json')));
  assert.equal(fs.existsSync(path.join(app, 'node_modules', 'typescript')), false);

  h = await health(r);
  assert.equal(h.healthy, true);
  assert.match(check(h, 'playwright').detail, /^version \d+\.\d+/);

  // The same server process now records.
  const started = await r.api('POST', '/api/start', { ticket: 'PM-1', profile: 'elkjop' });
  assert.equal(started.status, 200, started.body.error);
  const page = await chrome.context.newPage();
  await page.goto(`${r.url}/demo`);
  await waitFor('the navigation', () => r.timeline('PM-1').some((e) => e.type === 'navigate'));
  assert.equal((await r.api('POST', '/api/stop')).status, 200);
});

test('the page shows the version and opens on the checklist until the Mac is healthy', async () => {
  const r = await start();
  const page = (await r.api('GET', '/')).body;
  assert.match(page, /id="app-version"/, 'the version in the header');
  assert.match(page, /id="nav-setup"/, 'a Setup link from any page');
  assert.match(page, /id="setup-view"/);
  assert.match(page, /id="recorder-view"/);
  assert.match(page, /\/api\/health/);
  assert.match(page, /data-setup="install"/);
  assert.match(page, /data-setup="create-profile"/);
});
