// Export: the Copywriter sends a Ticket to the developer by dropping its zip into the folder her
// SharePoint/OneDrive client syncs, set once in the settings.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { launchChrome, startRecorder, waitFor, type Chrome, type Recorder } from './harness.ts';

let recorder: Recorder;
let chromes: Chrome[];
let synced: string; // stands in for her synced SharePoint folder

beforeEach(async () => {
  recorder = await startRecorder();
  chromes = [];
  synced = await mkdtemp(path.join(os.tmpdir(), 'recorder-export-'));
});

afterEach(async () => {
  for (const c of chromes) await c.close();
  await recorder.close();
  fs.chmodSync(synced, 0o755);
  await rm(synced, { recursive: true, force: true });
});

const saveSettings = (settings: unknown) => recorder.api('POST', '/api/settings', settings);
const exportTicket = (ticket: string) => recorder.api('POST', '/api/tickets/export', { ticket });
const exported = () => fs.readdirSync(synced).sort();
const zipEntries = (zip: string) => execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).split('\n').filter(Boolean);
const zipFile = (zip: string, entry: string) => execFileSync('unzip', ['-p', zip, entry], { encoding: 'utf8' });

async function createTicket(ticket: string) {
  const res = await recorder.api('POST', '/api/tickets', { ticket });
  assert.equal(res.status, 200, res.body.error);
}

test('settings are read, saved and kept across a restart', async () => {
  const initial = await recorder.api('GET', '/api/settings');
  assert.equal(initial.status, 200, initial.body.error);
  assert.equal(initial.body.exportDir, null);

  const saved = await saveSettings({ exportDir: `  ${synced}  ` });
  assert.equal(saved.status, 200, saved.body.error);
  assert.equal(saved.body.exportDir, synced);
  // A small file next to the recordings, outside the app folder.
  const file = path.join(recorder.recordingsDir, 'settings.json');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).exportDir, synced);

  await recorder.restart();
  assert.equal((await recorder.api('GET', '/api/settings')).body.exportDir, synced);

  const relative = await saveSettings({ exportDir: 'Documents/Recordings' });
  assert.equal(relative.status, 400);
  assert.match(relative.body.error, /full path/);
  const missing = await saveSettings({ exportDir: path.join(synced, 'nope') });
  assert.equal(missing.status, 400);
  assert.match(missing.body.error, /does not exist/);
  assert.equal((await recorder.api('GET', '/api/settings')).body.exportDir, synced, 'a refused save keeps the old folder');

  const cleared = await saveSettings({ exportDir: '' });
  assert.equal(cleared.status, 200, cleared.body.error);
  assert.equal(cleared.body.exportDir, null);
  await recorder.restart();
  assert.equal((await recorder.api('GET', '/api/settings')).body.exportDir, null);
});

test('exports the Ticket current contents as a new zip each time, and records when', async () => {
  const { body: profile } = await recorder.api('POST', '/api/profiles', { name: 'elkjop' });
  const chrome = await launchChrome(profile);
  chromes.push(chrome);
  await createTicket('PM-1');
  assert.equal(recorder.ticketJson('PM-1').lastExport, null);
  assert.equal((await recorder.api('POST', '/api/start', { ticket: 'PM-1', profile: 'elkjop' })).status, 200);
  const page = await chrome.context.newPage();
  await page.goto(`${recorder.url}/demo`);
  await waitFor('the navigation', () => recorder.timeline('PM-1').some((e) => e.type === 'navigate'));
  assert.equal((await recorder.api('POST', '/api/stop')).status, 200);
  // Changed after the last Finish: the export must still carry it.
  await recorder.api('POST', '/api/tickets/briefing', { ticket: 'PM-1', briefing: 'Edited after Finish' });
  assert.equal((await saveSettings({ exportDir: synced })).status, 200);

  const before = Date.now();
  const first = await exportTicket('PM-1');
  assert.equal(first.status, 200, first.body.error);
  const [name] = exported();
  assert.match(name, /^PM-1-\d{8}T\d{6}Z\.zip$/);
  assert.equal(first.body.lastExport.file, path.join(synced, name));
  const at = Date.parse(first.body.lastExport.at);
  assert.ok(at >= before - 1000 && at <= Date.now(), 'export time is now');

  const zip = path.join(synced, name);
  const entries = zipEntries(zip);
  for (const e of ['ticket.json', 'timeline.jsonl', 'traces/session-1.zip']) assert.ok(entries.includes(e), `${e} in ${entries}`);
  assert.equal(JSON.parse(zipFile(zip, 'ticket.json')).briefing, 'Edited after Finish');
  assert.equal(zipFile(zip, 'timeline.jsonl'), fs.readFileSync(path.join(recorder.recordingsDir, 'PM-1', 'timeline.jsonl'), 'utf8'));
  for (const e of entries.filter((e) => e.startsWith('screenshots/') && !e.endsWith('/'))) {
    assert.ok(fs.existsSync(path.join(recorder.recordingsDir, 'PM-1', e)), e);
  }

  // The Ticket records its last export, on disk and in the history.
  assert.deepEqual(recorder.ticketJson('PM-1').lastExport, first.body.lastExport);
  const listed = (await recorder.api('GET', '/api/tickets')).body.find((t: any) => t.ticket === 'PM-1');
  assert.deepEqual(listed.lastExport, first.body.lastExport);

  // A re-export, even within the same second, never overwrites the first.
  const firstBytes = fs.readFileSync(zip);
  const second = await exportTicket('PM-1');
  assert.equal(second.status, 200, second.body.error);
  assert.equal(exported().length, 2, `two files: ${exported()}`);
  assert.ok(exported().every((f) => /^PM-1-\d{8}T\d{6}Z(-\d+)?\.zip$/.test(f)), `${exported()}`);
  assert.deepEqual(fs.readFileSync(zip), firstBytes, 'first export untouched');
  assert.notEqual(second.body.lastExport.file, first.body.lastExport.file);
  assert.deepEqual(recorder.ticketJson('PM-1').lastExport, second.body.lastExport);

  await recorder.restart();
  const afterRestart = (await recorder.api('GET', '/api/tickets')).body.find((t: any) => t.ticket === 'PM-1');
  assert.deepEqual(afterRestart.lastExport, second.body.lastExport);
});

test('export is refused while the Ticket records', async () => {
  const { body: profile } = await recorder.api('POST', '/api/profiles', { name: 'elkjop' });
  chromes.push(await launchChrome(profile));
  await createTicket('PM-2');
  await createTicket('PM-3');
  assert.equal((await saveSettings({ exportDir: synced })).status, 200);
  assert.equal((await recorder.api('POST', '/api/start', { ticket: 'PM-2', profile: 'elkjop' })).status, 200);

  const refused = await exportTicket('PM-2');
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /PM-2 is being recorded/);
  assert.deepEqual(exported(), []);
  assert.equal(recorder.ticketJson('PM-2').lastExport, null);
  // Another Ticket can still be exported.
  assert.equal((await exportTicket('PM-3')).status, 200);
  assert.equal(exported().length, 1);

  assert.equal((await recorder.api('POST', '/api/stop')).status, 200);
  assert.equal((await exportTicket('PM-2')).status, 200);
  assert.equal(exported().length, 2);
});

test('export is refused without a usable export folder', async () => {
  await createTicket('PM-4');
  const noFolder = await exportTicket('PM-4');
  assert.equal(noFolder.status, 409);
  assert.match(noFolder.body.error, /export folder/i);

  assert.equal((await saveSettings({ exportDir: synced })).status, 200);
  fs.chmodSync(synced, 0o555);
  const readOnly = await exportTicket('PM-4');
  assert.equal(readOnly.status, 409);
  assert.match(readOnly.body.error, /not writable/);
  fs.chmodSync(synced, 0o755);
  assert.deepEqual(exported(), []);

  // The synced folder went away after it was set (e.g. OneDrive signed out).
  const gone = path.join(synced, 'gone');
  fs.mkdirSync(gone);
  assert.equal((await saveSettings({ exportDir: gone })).status, 200);
  fs.rmdirSync(gone);
  const missing = await exportTicket('PM-4');
  assert.equal(missing.status, 409);
  assert.match(missing.body.error, /not available/);
  assert.equal(recorder.ticketJson('PM-4').lastExport, null);

  assert.equal((await exportTicket('PM-404')).status, 404);
  assert.equal((await exportTicket('../x')).status, 400);
});
