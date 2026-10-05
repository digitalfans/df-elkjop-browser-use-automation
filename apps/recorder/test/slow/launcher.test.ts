// The launcher on a fresh Mac, for real: it downloads Node.js from nodejs.org and installs the app's
// dependencies from npm, so it is slow and needs the network. Run with `npm run test:slow`.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { copyApp, freePort, runLauncher, waitFor } from '../harness.ts';

let cleanup: (() => Promise<unknown>)[] = [];
after(async () => {
  for (const fn of cleanup.reverse()) await fn();
});

test('with no Node.js and empty data folders, the launcher brings up a server healthy except for Work Profiles', { timeout: 15 * 60_000 }, async () => {
  const dir = await copyApp();
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const data = await mkdtemp(path.join(os.tmpdir(), 'recorder-data-'));
  cleanup.push(() => rm(data, { recursive: true, force: true }));
  const port = await freePort();
  const l = runLauncher(dir, {
    RECORDER_PORT: String(port), RECORDER_NO_OPEN: '1',
    RECORDINGS_DIR: path.join(data, 'recordings'), PROFILES_DIR: path.join(data, 'profiles'),
  });
  cleanup.push(() => l.stop());

  const health = await waitFor('the app to answer', async () => {
    const code = await Promise.race([l.exited, null]);
    if (code !== null) throw new Error(`The launcher exited (${code}):\n${l.output()}`);
    const res = await fetch(`http://127.0.0.1:${port}/api/health`).catch(() => null);
    return res?.ok ? res.json() : null;
  }, 14 * 60_000);

  const failing = health.checks.filter((c: any) => !c.ok && c.required).map((c: any) => c.id);
  assert.deepEqual(failing, ['profile'], l.output());
  assert.equal(health.healthy, false);
  // The private, verified Node.js in the app folder runs the app.
  const node = health.checks.find((c: any) => c.id === 'node');
  assert.ok(node.detail.includes(path.join(fs.realpathSync(dir), '.runtime', 'node', 'bin', 'node')) ||
    node.detail.includes(path.join(dir, '.runtime', 'node', 'bin', 'node')), node.detail);
  // Only the runtime dependency, without any browser download.
  assert.ok(fs.existsSync(path.join(dir, 'node_modules', 'playwright', 'package.json')));
  assert.equal(fs.existsSync(path.join(dir, 'node_modules', 'typescript')), false);
  assert.doesNotMatch(l.output(), /Downloading (Chromium|Chrome|Firefox|Webkit)/i);
  // Nothing of the download left behind.
  assert.deepEqual(fs.readdirSync(path.join(dir, '.runtime')), ['node']);
});
