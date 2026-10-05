// Interrupted Recording Sessions: a crash, a closed Terminal or a restart never loses one.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { launchChrome, startRecorder, waitFor, type Chrome, type Recorder } from './harness.ts';

let recorder: Recorder;
let chrome: Chrome;

beforeEach(async () => {
  recorder = await startRecorder();
  const { status, body: profile } = await recorder.api('POST', '/api/profiles', { name: 'elkjop' });
  assert.equal(status, 200, profile.error);
  chrome = await launchChrome(profile);
  assert.equal((await recorder.api('POST', '/api/tickets', { ticket: 'PM-1' })).status, 200);
});

afterEach(async () => {
  await chrome?.close();
  await recorder.close();
});

async function ok(method: string, route: string, body?: unknown) {
  const res = await recorder.api(method, route, body);
  assert.equal(res.status, 200, res.body?.error);
  return res.body;
}

const state = () => ok('GET', '/api/state');
const zip = () => path.join(recorder.recordingsDir, 'PM-1.zip');
const zippedTicket = () => JSON.parse(execFileSync('unzip', ['-p', zip(), 'ticket.json'], { encoding: 'utf8' }));
const recorded = (what: string, match: (e: any) => boolean) => waitFor(what, () => recorder.timeline('PM-1').find(match));

async function clickSave(page: import('playwright').Page) {
  const before = recorder.timeline('PM-1').filter((e) => e.type === 'click').length;
  await page.getByRole('button', { name: 'Save' }).click();
  await waitFor('the click', () => recorder.timeline('PM-1').filter((e) => e.type === 'click').length > before);
}

test('a Recording Session killed mid-recording is recovered on the next start, and can be continued', async () => {
  const page = await chrome.context.newPage();
  await page.goto(`${recorder.url}/demo`);
  await ok('POST', '/api/start', { ticket: 'PM-1', profile: 'elkjop' });
  await ok('POST', '/api/annotate', { kind: 'step', text: 'Find the English Master' });
  await clickSave(page);
  await ok('POST', '/api/annotate', { kind: 'observation', text: 'Used the Swedish copy from the comments' });
  const before = recorder.timeline('PM-1');
  assert.ok(!fs.existsSync(zip()));

  await recorder.restart('SIGKILL');

  // Closed from the events already on disk, every one of them kept as written.
  assert.deepEqual(recorder.timeline('PM-1'), before);
  const ticket = recorder.ticketJson('PM-1');
  assert.equal(ticket.sessions.length, 1);
  const [s] = ticket.sessions;
  assert.equal(s.n, 1);
  assert.equal(s.profile, 'elkjop');
  assert.equal(s.recovered, true);
  assert.equal(s.events, before.length);
  assert.equal(s.annotations, 2);
  assert.equal(s.trace, null);
  assert.equal(Date.parse(s.finishedAt) - Date.parse(s.startedAt), before.at(-1).t, 'finished at the last event');
  assert.equal((await state()).status, 'idle');

  const listed = (await ok('GET', '/api/tickets')).tickets.find((t: any) => t.ticket === 'PM-1');
  assert.equal(listed.totals.sessions, 1);
  assert.equal(listed.totals.events, before.length);
  assert.equal(listed.recording, false);

  // The Ticket's zip is rebuilt with the recovered summary.
  assert.ok(fs.existsSync(zip()), 'the Ticket zip is rebuilt during recovery');
  assert.equal(zippedTicket().sessions[0].recovered, true);

  // The notice stays until she dismisses it, even across another restart, and recovery runs once.
  const notice = [{ ticket: 'PM-1', session: 1, events: before.length, finishedAt: s.finishedAt }];
  assert.deepEqual((await state()).recovered, notice);
  assert.match((await recorder.api('GET', '/')).body, /id="recovery-notice"/);
  await recorder.restart();
  assert.deepEqual((await state()).recovered, notice);
  assert.deepEqual(recorder.ticketJson('PM-1').sessions, ticket.sessions);
  await ok('POST', '/api/recovery/dismiss');
  assert.deepEqual((await state()).recovered, []);
  await recorder.restart();
  assert.deepEqual((await state()).recovered, []);

  // Continuing it is a normal next Recording Session, in the Step she was in.
  await ok('POST', '/api/start', { ticket: 'PM-1', profile: 'elkjop' });
  assert.deepEqual((await state()).step, { n: 1, text: 'Find the English Master' });
  await clickSave(page);
  await ok('POST', '/api/stop');
  const events = recorder.timeline('PM-1');
  assert.deepEqual(events.map((e) => e.seq), events.map((_, i) => i + 1), 'seq is global and continuous');
  const second = events.filter((e) => e.session === 2);
  assert.deepEqual(second.map((e) => e.type), ['start', 'click', 'stop']);
  for (const e of second) assert.equal(e.step, 1);
  const sessions = recorder.ticketJson('PM-1').sessions;
  assert.deepEqual(sessions.map((x: any) => [x.n, x.recovered ?? false]), [[1, true], [2, false]]);
  assert.equal(sessions[1].trace, 'traces/session-2.zip');
});

test('an interrupted Recording Session with only its start event is recovered too', async () => {
  await ok('POST', '/api/start', { ticket: 'PM-1', profile: 'elkjop' });
  await recorded('the start', (e) => e.type === 'start');
  await recorder.restart('SIGKILL');
  const [s] = recorder.ticketJson('PM-1').sessions;
  assert.equal(s.recovered, true);
  assert.equal(s.events, 1);
  const [start] = recorder.timeline('PM-1');
  assert.equal(Date.parse(s.finishedAt) - Date.parse(s.startedAt), start.t);
  assert.deepEqual((await state()).recovered.map((r: any) => r.ticket), ['PM-1']);
});

test('a normal Finish leaves no marker and triggers no recovery', async () => {
  const before = fs.readdirSync(recorder.recordingsDir).sort();
  await ok('POST', '/api/start', { ticket: 'PM-1', profile: 'elkjop' });
  assert.ok(fs.readdirSync(recorder.recordingsDir).length > before.length, 'starting leaves an open-session marker');
  await ok('POST', '/api/stop');
  assert.deepEqual(fs.readdirSync(recorder.recordingsDir).sort(), [...before, 'PM-1.zip'].sort());
  const ticket = recorder.ticketJson('PM-1');
  assert.equal(ticket.sessions[0].recovered, undefined);

  await recorder.restart('SIGKILL');
  assert.deepEqual((await state()).recovered, []);
  assert.deepEqual(recorder.ticketJson('PM-1'), ticket);
});

test('a last event cut off by the crash is dropped, and the next Recording Session appends cleanly', async () => {
  await ok('POST', '/api/start', { ticket: 'PM-1', profile: 'elkjop' });
  const start = await recorded('the start', (e) => e.type === 'start');
  // What a kill in the middle of writing a line leaves behind.
  fs.appendFileSync(path.join(recorder.recordingsDir, 'PM-1', 'timeline.jsonl'), '{"seq":2,"session":1,"ty');
  await recorder.restart('SIGKILL');
  assert.deepEqual(recorder.timeline('PM-1'), [start]);
  assert.equal(recorder.ticketJson('PM-1').sessions[0].events, 1);

  await ok('POST', '/api/start', { ticket: 'PM-1', profile: 'elkjop' });
  await ok('POST', '/api/stop');
  assert.deepEqual(recorder.timeline('PM-1').map((e) => [e.seq, e.session, e.type]), [[1, 1, 'start'], [2, 2, 'start'], [3, 2, 'stop']]);
});
