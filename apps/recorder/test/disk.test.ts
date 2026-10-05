// Disk usage: the Copywriter sees how much disk her Recordings use, and a warning above a limit she
// can change in the settings. Nothing is ever deleted automatically.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { launchChrome, startRecorder, waitFor, type Chrome, type Recorder } from './harness.ts';

const GB = 1e9;

let recorder: Recorder;
let chromes: Chrome[];

beforeEach(async () => {
  recorder = await startRecorder();
  chromes = [];
});

afterEach(async () => {
  for (const c of chromes) await c.close();
  await recorder.close();
});

const listing = async () => {
  const res = await recorder.api('GET', '/api/tickets');
  assert.equal(res.status, 200, res.body.error);
  return res.body as { tickets: any[]; disk: { total: number; limit: number; warning: boolean } };
};
const saveSettings = (settings: unknown) => recorder.api('POST', '/api/settings', settings);

async function createTicket(ticket: string) {
  const res = await recorder.api('POST', '/api/tickets', { ticket });
  assert.equal(res.status, 200, res.body.error);
}

// A Ticket with a finished Recording Session: timeline, screenshots and trace.
async function recordTicket(ticket: string) {
  const { body: profile } = await recorder.api('POST', '/api/profiles', { name: 'elkjop' });
  const chrome = await launchChrome(profile);
  chromes.push(chrome);
  await createTicket(ticket);
  assert.equal((await recorder.api('POST', '/api/start', { ticket, profile: 'elkjop' })).status, 200);
  const page = await chrome.context.newPage();
  await page.goto(`${recorder.url}/demo`);
  await waitFor('the navigation', () => recorder.timeline(ticket).some((e) => e.type === 'navigate'));
  assert.equal((await recorder.api('POST', '/api/stop')).status, 200);
}

// Bytes of every file under a folder, or of the file itself.
function bytes(p: string): number {
  const st = fs.statSync(p, { throwIfNoEntry: false });
  if (!st) return 0;
  if (!st.isDirectory()) return st.size;
  return fs.readdirSync(p).reduce((n, name) => n + bytes(path.join(p, name)), 0);
}
const ticketBytes = (ticket: string) =>
  bytes(path.join(recorder.recordingsDir, ticket)) + bytes(path.join(recorder.recordingsDir, `${ticket}.zip`));

// Every file in the recordings folder with its contents' hash and modification time.
function snapshot(dir: string, out: Record<string, string> = {}) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) snapshot(p, out);
    else out[p] = `${st.size} ${st.mtimeMs} ${createHash('sha1').update(fs.readFileSync(p)).digest('hex')}`;
  }
  return out;
}

test('lists each Ticket with its size on disk, and the total', async () => {
  assert.deepEqual((await listing()).disk, { total: 0, limit: 5 * GB, warning: false });

  await recordTicket('PM-1');
  await createTicket('PM-2');
  assert.ok(!fs.existsSync(path.join(recorder.recordingsDir, 'PM-1.zip')), 'Finish leaves no zip');

  const { tickets, disk } = await listing();
  const pm1 = tickets.find((t) => t.ticket === 'PM-1');
  const pm2 = tickets.find((t) => t.ticket === 'PM-2');
  // Each Ticket counts its folder (and a zip next to it, if a version before 0.2.0 left one).
  assert.equal(pm1.size, ticketBytes('PM-1'));
  assert.ok(pm1.size > 0);
  assert.equal(pm2.size, ticketBytes('PM-2'));
  assert.ok(pm2.size > 0);
  // Only Tickets count, not the settings or other files in the recordings folder.
  assert.equal((await saveSettings({ diskLimitGB: 5 })).status, 200);
  assert.equal((await listing()).disk.total, pm1.size + pm2.size);
  assert.equal(disk.total, pm1.size + pm2.size);
  assert.equal(disk.warning, false);

  // A deleted Ticket no longer counts.
  assert.equal((await recorder.api('POST', '/api/tickets/delete', { ticket: 'PM-1' })).status, 200);
  assert.equal((await listing()).disk.total, pm2.size);
});

test('warns above the limit set in the settings, and never removes or changes a Ticket', async () => {
  await recordTicket('PM-1');
  await createTicket('PM-2');
  const { disk } = await listing();
  assert.ok(disk.total > 0);
  assert.equal((await recorder.api('GET', '/api/settings')).body.diskLimitGB, 5, 'defaults to 5 GB');

  const before = snapshot(recorder.recordingsDir);
  const half = Math.floor(disk.total / 2);
  const below = await saveSettings({ diskLimitGB: half / GB });
  assert.equal(below.status, 200, below.body.error);
  assert.equal(below.body.diskLimitGB, half / GB);
  const over = await listing();
  assert.equal(over.disk.warning, true);
  assert.equal(over.disk.limit, half);
  assert.deepEqual(over.tickets.map((t) => t.ticket).sort(), ['PM-1', 'PM-2']);
  // Listing again over the limit, and across a restart, still removes nothing.
  await listing();
  await recorder.restart();
  assert.equal((await recorder.api('GET', '/api/settings')).body.diskLimitGB, half / GB, 'kept across a restart');
  assert.equal((await listing()).disk.warning, true);
  const after = snapshot(recorder.recordingsDir);
  delete after[path.join(recorder.recordingsDir, 'settings.json')];
  assert.deepEqual(after, before);
  assert.deepEqual(fs.readdirSync(recorder.trashDir), []);

  const above = await saveSettings({ diskLimitGB: (disk.total * 2) / GB });
  assert.equal(above.status, 200, above.body.error);
  assert.equal((await listing()).disk.warning, false);

  // Typed in the page as text; only a positive number of GB is accepted.
  assert.equal((await saveSettings({ diskLimitGB: ' 12.5 ' })).body.diskLimitGB, 12.5);
  for (const bad of [0, -1, 'lots', '', null, true]) {
    const refused = await saveSettings({ diskLimitGB: bad });
    assert.equal(refused.status, 400, `${JSON.stringify(bad)} refused`);
    assert.match(refused.body.error, /Disk warning limit/);
  }
  assert.equal((await recorder.api('GET', '/api/settings')).body.diskLimitGB, 12.5, 'a refused save keeps the old limit');
  assert.equal((await listing()).disk.limit, 12.5 * GB);
  // Saving only the export folder keeps the limit.
  assert.equal((await saveSettings({ exportDir: '' })).body.diskLimitGB, 12.5);
});
