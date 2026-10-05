// Ticket history, Briefing and continued Recording Sessions: what the Copywriter organizes across Tickets.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { launchChrome, sleep, startRecorder, waitFor, type Chrome, type Recorder } from './harness.ts';

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

async function openProfile(name: string) {
  const { status, body: profile } = await recorder.api('POST', '/api/profiles', { name });
  assert.equal(status, 200, profile.error);
  const chrome = await launchChrome(profile);
  chromes.push(chrome);
  return chrome;
}

async function createTicket(ticket: string) {
  const res = await recorder.api('POST', '/api/tickets', { ticket });
  assert.equal(res.status, 200, res.body.error);
  return res.body;
}

async function record(ticket: string, profile: string, act: () => Promise<void>) {
  const started = await recorder.api('POST', '/api/start', { ticket, profile });
  assert.equal(started.status, 200, started.body.error);
  await act();
  const stopped = await recorder.api('POST', '/api/stop');
  assert.equal(stopped.status, 200, stopped.body.error);
}

const tickets = async () => {
  const res = await recorder.api('GET', '/api/tickets');
  assert.equal(res.status, 200, res.body.error);
  return res.body as any[];
};

const zipEntries = (zip: string) => execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).split('\n').filter(Boolean);

test('lists Tickets from disk with their totals, newest first, across a restart', async () => {
  assert.deepEqual(await tickets(), []);
  const chrome = await openProfile('elkjop');
  await createTicket('PM-1');
  await sleep(10);
  await createTicket('PM-2');
  await record('PM-1', 'elkjop', async () => {
    const page = await chrome.context.newPage();
    await page.goto(`${recorder.url}/demo`);
    await waitFor('the navigation', () => recorder.timeline('PM-1').some((e) => e.type === 'navigate'));
  });
  const briefing = 'Please find launch page LP - RTX Spark\nready on EN-local, live 10 Oct 09:00.';
  assert.equal((await recorder.api('POST', '/api/tickets/briefing', { ticket: 'PM-2', briefing })).status, 200);

  const check = async () => {
    const list = await tickets();
    assert.deepEqual(list.map((t) => t.ticket), ['PM-2', 'PM-1']);
    const [pm2, pm1] = list;
    assert.equal(pm2.briefing, briefing);
    assert.equal(pm2.excerpt, 'Please find launch page LP - RTX Spark ready on EN-local, live 10 Oct 09:00.');
    assert.deepEqual(pm2.totals, { sessions: 0, events: 0, screenshots: 0 });
    assert.equal(pm2.recording, false);
    assert.equal(pm1.excerpt, '');
    assert.equal(pm1.totals.sessions, 1);
    assert.equal(pm1.totals.events, recorder.timeline('PM-1').length);
    assert.ok(pm1.totals.events >= 4);
    assert.equal(pm1.sessions.length, 1);
    assert.equal(pm1.sessions[0].n, 1);
    assert.equal(pm1.dir, path.join(recorder.recordingsDir, 'PM-1'));
    for (const t of list) assert.ok(!Number.isNaN(Date.parse(t.updatedAt)));
  };
  await check();
  await recorder.restart();
  await check();
});

test('opening an existing Ticket ID returns it, flagged as already existing', async () => {
  const created = await createTicket('PM-3');
  assert.equal(created.existed, false);
  await recorder.api('POST', '/api/tickets/briefing', { ticket: 'PM-3', briefing: 'Localize the VC.' });
  const opened = await createTicket('PM-3');
  assert.equal(opened.existed, true);
  assert.equal(opened.ticket, 'PM-3');
  assert.equal(opened.briefing, 'Localize the VC.');
  assert.equal(opened.createdAt, created.createdAt);
  assert.deepEqual((await tickets()).map((t) => t.ticket), ['PM-3']);
});

test('saves and edits the Briefing, refused while that Ticket records', async () => {
  await createTicket('PM-4');
  await createTicket('PM-5');
  const save = (ticket: string, briefing: string) => recorder.api('POST', '/api/tickets/briefing', { ticket, briefing });

  const saved = await save('PM-4', '  First version  ');
  assert.equal(saved.status, 200, saved.body.error);
  assert.equal(saved.body.briefing, 'First version');
  assert.equal(recorder.ticketJson('PM-4').briefing, 'First version');
  assert.equal((await save('PM-4', 'Second version')).status, 200);
  assert.equal(recorder.ticketJson('PM-4').briefing, 'Second version');
  assert.equal((await save('PM-4', '   ')).status, 200);
  assert.equal(recorder.ticketJson('PM-4').briefing, null);

  assert.equal((await save('PM-404', 'x')).status, 404);

  await openProfile('elkjop');
  assert.equal((await save('PM-4', 'Before recording')).status, 200);
  assert.equal((await recorder.api('POST', '/api/start', { ticket: 'PM-4', profile: 'elkjop' })).status, 200);
  const refused = await save('PM-4', 'While recording');
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /PM-4 is being recorded/);
  assert.equal((await tickets()).find((t) => t.ticket === 'PM-4').recording, true);
  // Another Ticket's Briefing can still be edited.
  assert.equal((await save('PM-5', 'Other Ticket')).status, 200);
  assert.equal((await recorder.api('POST', '/api/stop')).status, 200);

  assert.equal(recorder.ticketJson('PM-4').briefing, 'Before recording');
  assert.equal((await save('PM-4', 'After recording')).status, 200);
  assert.equal(recorder.ticketJson('PM-4').briefing, 'After recording');
});

test('a second Recording Session continues the same timeline', async () => {
  const chrome = await openProfile('elkjop');
  await createTicket('PM-6');
  const page = await chrome.context.newPage();
  await page.goto(`${recorder.url}/demo`);

  const clickSave = async () => {
    const before = recorder.timeline('PM-6').filter((e) => e.type === 'click').length;
    await page.getByRole('button', { name: 'Save' }).click();
    await waitFor('the click', () => recorder.timeline('PM-6').filter((e) => e.type === 'click').length > before);
  };
  await record('PM-6', 'elkjop', clickSave);
  const zip = path.join(recorder.recordingsDir, 'PM-6.zip');
  assert.ok(fs.existsSync(zip), 'the Ticket zip is built at Finish');
  assert.ok(zipEntries(zip).includes('traces/session-1.zip'));
  assert.ok(!zipEntries(zip).includes('traces/session-2.zip'));
  const firstShots = fs.readdirSync(path.join(recorder.recordingsDir, 'PM-6', 'screenshots'));
  const firstBytes = new Map(firstShots.map((f) => [f, fs.readFileSync(path.join(recorder.recordingsDir, 'PM-6', 'screenshots', f))]));

  // The page stays open across sessions, as it would in her Chrome.
  await record('PM-6', 'elkjop', clickSave);

  const events = recorder.timeline('PM-6');
  assert.deepEqual(events.map((e) => e.seq), events.map((_, i) => i + 1), 'seq is global and continuous');
  assert.deepEqual(events.map((e) => [e.session, e.type]), [
    [1, 'start'], [1, 'click'], [1, 'stop'],
    [2, 'start'], [2, 'click'], [2, 'stop'],
  ]);

  const ticket = recorder.ticketJson('PM-6');
  assert.deepEqual(ticket.sessions.map((s: any) => [s.n, s.profile, s.events, s.trace]), [
    [1, 'elkjop', 3, 'traces/session-1.zip'],
    [2, 'elkjop', 3, 'traces/session-2.zip'],
  ]);
  const dir = path.join(recorder.recordingsDir, 'PM-6');
  for (const s of ticket.sessions) assert.ok(fs.statSync(path.join(dir, s.trace)).size > 0, `trace of session ${s.n}`);

  const shots = events.filter((e) => e.screenshot).map((e) => e.screenshot);
  assert.equal(new Set(shots).size, shots.length, 'each screenshot has its own file');
  for (const s of shots) assert.ok(fs.existsSync(path.join(dir, s)), s);
  for (const [f, bytes] of firstBytes) assert.deepEqual(fs.readFileSync(path.join(dir, 'screenshots', f)), bytes, `${f} untouched`);

  // Rebuilt at the second Finish: it now holds the second session too.
  const entries = zipEntries(zip);
  assert.ok(entries.includes('traces/session-2.zip'));
  assert.ok(entries.includes('timeline.jsonl'));
  assert.ok(entries.includes('ticket.json'));
  for (const s of shots) assert.ok(entries.includes(s), `${s} in the zip`);

  const listed = (await tickets()).find((t) => t.ticket === 'PM-6');
  assert.equal(listed.totals.sessions, 2);
  assert.equal(listed.totals.events, 6);
});

test('deletes a Ticket to the Trash, refused while it records', async () => {
  const chrome = await openProfile('elkjop');
  await createTicket('PM-7');
  await createTicket('PM-8');
  await record('PM-7', 'elkjop', async () => {
    await chrome.context.newPage();
    await waitFor('the tab', () => recorder.timeline('PM-7').some((e) => e.type === 'tab-open'));
  });
  assert.ok(fs.existsSync(path.join(recorder.recordingsDir, 'PM-7.zip')));

  assert.equal((await recorder.api('POST', '/api/start', { ticket: 'PM-8', profile: 'elkjop' })).status, 200);
  const refused = await recorder.api('POST', '/api/tickets/delete', { ticket: 'PM-8' });
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /PM-8 is being recorded/);
  assert.ok(fs.existsSync(path.join(recorder.recordingsDir, 'PM-8', 'ticket.json')));

  const deleted = await recorder.api('POST', '/api/tickets/delete', { ticket: 'PM-7' });
  assert.equal(deleted.status, 200, deleted.body.error);
  assert.equal((await recorder.api('POST', '/api/stop')).status, 200);

  assert.ok(!fs.existsSync(path.join(recorder.recordingsDir, 'PM-7')));
  assert.ok(!fs.existsSync(path.join(recorder.recordingsDir, 'PM-7.zip')));
  const trashed = fs.readdirSync(recorder.trashDir);
  const folder = trashed.find((f) => f.startsWith('PM-7') && !f.endsWith('.zip'));
  assert.ok(folder, `PM-7 folder in the Trash: ${trashed}`);
  assert.ok(fs.existsSync(path.join(recorder.trashDir, folder, 'ticket.json')));
  assert.ok(fs.existsSync(path.join(recorder.trashDir, folder, 'timeline.jsonl')));
  assert.ok(trashed.includes(`${folder}.zip`), `PM-7 zip in the Trash: ${trashed}`);
  assert.deepEqual((await tickets()).map((t) => t.ticket), ['PM-8']);

  assert.equal((await recorder.api('POST', '/api/tickets/delete', { ticket: 'PM-7' })).status, 404);
  assert.equal((await recorder.api('POST', '/api/tickets/delete', { ticket: '../profiles' })).status, 400);

  // A Ticket with the same ID created again is a new one, and deleting it never overwrites the first in the Trash.
  await createTicket('PM-7');
  assert.equal((await recorder.api('POST', '/api/tickets/delete', { ticket: 'PM-7' })).status, 200);
  assert.equal(fs.readdirSync(recorder.trashDir).filter((f) => f.startsWith('PM-7') && !f.endsWith('.zip')).length, 2);
});

test('refuses to reveal an unknown Ticket folder', async () => {
  assert.equal((await recorder.api('POST', '/api/tickets/reveal', { ticket: 'PM-404' })).status, 404);
  assert.equal((await recorder.api('POST', '/api/tickets/reveal', { ticket: '../x' })).status, 400);
});
