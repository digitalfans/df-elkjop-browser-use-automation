// Step, Checkpoint and Observation annotations: the Copywriter's own words placed in the timeline.
import assert from 'node:assert/strict';
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

async function startRecording() {
  const started = await recorder.api('POST', '/api/start', { ticket: 'PM-1', profile: 'elkjop' });
  assert.equal(started.status, 200, started.body.error);
}

async function stopRecording() {
  const stopped = await recorder.api('POST', '/api/stop');
  assert.equal(stopped.status, 200, stopped.body.error);
  return recorder.timeline('PM-1');
}

async function annotate(kind: string, text: string) {
  const res = await recorder.api('POST', '/api/annotate', { kind, text });
  assert.equal(res.status, 200, res.body.error);
  return res.body;
}

const recorded = (what: string, match: (e: any) => boolean) =>
  waitFor(what, () => recorder.timeline('PM-1').find(match));

test('records each Annotation kind with its text, and tags every event with the current Step', async () => {
  await startRecording();
  await annotate('step', 'Find the English Master in Coremedia');
  const page = await chrome.context.newPage();
  await page.goto(`${recorder.url}/demo`);
  await page.getByRole('button', { name: 'Save' }).click();
  await recorded('the click', (e) => e.type === 'click');
  await annotate('checkpoint', 'Check the teaser text before it publishes');
  await annotate('observation', '  Used the Swedish copy from the comments, not the body  ');
  await annotate('step', 'Schedule the Validity');
  assert.deepEqual((await recorder.api('GET', '/api/state')).body.step, { n: 2, text: 'Schedule the Validity' });
  await page.getByLabel('Market').selectOption('SE');
  await recorded('the change', (e) => e.type === 'change');

  const events = await stopRecording();
  assert.deepEqual(events.map((e) => [e.type, e.kind, e.n, e.step]), [
    ['start', undefined, undefined, null],
    ['annotation', 'step', 1, 1],
    ['tab-open', undefined, undefined, 1],
    ['navigate', undefined, undefined, 1],
    ['click', undefined, undefined, 1],
    ['annotation', 'checkpoint', undefined, 1],
    ['annotation', 'observation', undefined, 1],
    ['annotation', 'step', 2, 2],
    ['change', undefined, undefined, 2],
    ['stop', undefined, undefined, 2],
  ]);
  const notes = events.filter((e) => e.type === 'annotation');
  assert.deepEqual(notes.map((e) => e.text), [
    'Find the English Master in Coremedia',
    'Check the teaser text before it publishes',
    'Used the Swedish copy from the comments, not the body',
    'Schedule the Validity',
  ]);

  const session = recorder.ticketJson('PM-1').sessions[0];
  assert.equal(session.annotations, 4);
  const listed = (await recorder.api('GET', '/api/tickets')).body.find((t: any) => t.ticket === 'PM-1');
  assert.equal(listed.totals.annotations, 4);
  assert.equal(listed.sessions[0].annotations, 4);
  assert.equal((await recorder.api('GET', '/api/state')).body.step, null, 'no current Step once idle');
});

test('an Annotation has a screenshot of the tab she was last on, once she has interacted with one', async () => {
  await startRecording();
  await annotate('observation', 'Nothing open yet');
  const page = await chrome.context.newPage();
  await page.goto(`${recorder.url}/demo`);
  await page.getByRole('button', { name: 'Save' }).click();
  const click = await recorded('the click', (e) => e.type === 'click');
  await annotate('checkpoint', 'Saved on the right page?');

  const events = await stopRecording();
  const [before, after] = events.filter((e) => e.type === 'annotation');
  assert.equal(before.screenshot, undefined);
  assert.equal(before.tab, null);
  assert.equal(after.tab, click.tab);
  assert.equal(after.url, `${recorder.url}/demo`);
  assert.match(after.screenshot, /^screenshots\/.+-annotation\.png$/);
  const file = path.join(recorder.recordingsDir, 'PM-1', after.screenshot);
  assert.ok(fs.existsSync(file) && fs.statSync(file).size > 0, 'the screenshot is on disk');
});

test('a second Recording Session starts in the last Step and continues numbering', async () => {
  await startRecording();
  await annotate('step', 'Read the Briefing');
  await annotate('step', 'Localize the Launch Page');
  await stopRecording();

  await startRecording();
  assert.deepEqual((await recorder.api('GET', '/api/state')).body.step, { n: 2, text: 'Localize the Launch Page' });
  await annotate('observation', 'Kept the English headline, as the Briefing asks');
  await annotate('step', 'Publish');
  const events = (await stopRecording()).filter((e) => e.session === 2);
  assert.deepEqual(events.map((e) => [e.type, e.kind, e.n, e.step]), [
    ['start', undefined, undefined, 2],
    ['annotation', 'observation', undefined, 2],
    ['annotation', 'step', 3, 3],
    ['stop', undefined, undefined, 3],
  ]);
  const listed = (await recorder.api('GET', '/api/tickets')).body.find((t: any) => t.ticket === 'PM-1');
  assert.deepEqual(listed.sessions.map((s: any) => s.annotations), [2, 2]);
  assert.equal(listed.totals.annotations, 4);
});

test('refuses to annotate while idle, with empty text or with an unknown kind', async () => {
  const idle = await recorder.api('POST', '/api/annotate', { kind: 'step', text: 'Too early' });
  assert.equal(idle.status, 409);
  assert.match(idle.body.error, /recording/);

  await startRecording();
  const empty = await recorder.api('POST', '/api/annotate', { kind: 'checkpoint', text: '   ' });
  assert.equal(empty.status, 400);
  const missing = await recorder.api('POST', '/api/annotate', { kind: 'checkpoint' });
  assert.equal(missing.status, 400);
  const unknown = await recorder.api('POST', '/api/annotate', { kind: 'note', text: 'Hello' });
  assert.equal(unknown.status, 400);
  assert.match(unknown.body.error, /note/);
  const events = await stopRecording();
  assert.deepEqual(events.map((e) => e.type), ['start', 'stop']);
  assert.equal(recorder.ticketJson('PM-1').sessions[0].annotations, 0);
});
