// Work Profiles managed from the app: created, opened as their own Chrome, closed as a regular quit (ADR 0001).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { chromePid, connectChrome, isAlive, startRecorder, waitFor, type Recorder } from './harness.ts';

let recorder: Recorder;

beforeEach(async () => {
  recorder = await startRecorder();
});

afterEach(async () => {
  await recorder.close();
});

async function create(name: string) {
  const { status, body } = await recorder.api('POST', '/api/profiles', { name });
  assert.equal(status, 200, body.error);
  return body;
}

const listed = async () => (await recorder.api('GET', '/api/profiles')).body.map((p: any) => [p.name, p.open]);

test('opens a Work Profile as its own Chrome on its port, and closes it as a regular quit', async () => {
  const profile = await create('elkjop');
  await create('other');

  const opened = await recorder.api('POST', '/api/profiles/open', { name: 'elkjop' });
  assert.equal(opened.status, 200, opened.body.error);
  assert.deepEqual(await listed(), [['elkjop', true], ['other', false]]);
  const version = await (await fetch(`http://127.0.0.1:${profile.port}/json/version`)).json();
  assert.match(version.Browser, /Chrome/);
  const pid = chromePid(profile.dir);
  assert.ok(pid && isAlive(pid), 'a Chrome holds the Work Profile folder');

  // Opening one that is already open is harmless.
  assert.equal((await recorder.api('POST', '/api/profiles/open', { name: 'elkjop' })).status, 200);
  assert.equal(chromePid(profile.dir), pid);

  const closed = await recorder.api('POST', '/api/profiles/close', { name: 'elkjop' });
  assert.equal(closed.status, 200, closed.body.error);
  assert.deepEqual(await listed(), [['elkjop', false], ['other', false]]);
  await waitFor('the Chrome process to end', () => !isAlive(pid));
  // A regular quit releases the folder; a killed Chrome would leave its lock behind.
  assert.equal(fs.existsSync(path.join(profile.dir, 'SingletonLock')), false);
});

async function open(name: string) {
  const profile = await create(name);
  const opened = await recorder.api('POST', '/api/profiles/open', { name });
  assert.equal(opened.status, 200, opened.body.error);
  return profile;
}

// Records one Recording Session of `ticket` on `profile`, visiting the demo page at `?from=<profile>`.
async function recordVisit(ticket: string, profile: any) {
  assert.equal((await recorder.api('POST', '/api/tickets', { ticket })).status, 200);
  const started = await recorder.api('POST', '/api/start', { ticket, profile: profile.name });
  assert.equal(started.status, 200, started.body.error);
  const chrome = await connectChrome(profile);
  const url = `${recorder.url}/demo?from=${profile.name}`;
  const page = await chrome.context.newPage();
  await page.goto(url);
  await waitFor('the navigation', () => recorder.timeline(ticket).some((e) => e.type === 'navigate' && e.url === url));
  await chrome.close();
  return url;
}

test('two Work Profiles open at once are recorded independently, each session naming its own', async () => {
  const a = await open('elkjop');
  const b = await open('elkjop-no');
  assert.notEqual(a.port, b.port);
  assert.deepEqual(await listed(), [['elkjop', true], ['elkjop-no', true]]);

  const urlA = await recordVisit('PM-1', a);
  // The Work Profile being recorded cannot be closed; another one can.
  const refused = await recorder.api('POST', '/api/profiles/close', { name: 'elkjop' });
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /elkjop is being recorded/);
  assert.equal((await recorder.api('POST', '/api/stop')).status, 200);

  const urlB = await recordVisit('PM-2', b);
  assert.equal((await recorder.api('POST', '/api/stop')).status, 200);
  assert.deepEqual(await listed(), [['elkjop', true], ['elkjop-no', true]], 'both still open after recording');

  const visited = (ticket: string) => recorder.timeline(ticket).filter((e) => e.type === 'navigate').map((e) => e.url);
  assert.deepEqual(visited('PM-1'), [urlA]);
  assert.deepEqual(visited('PM-2'), [urlB]);
  assert.deepEqual(recorder.ticketJson('PM-1').sessions.map((s: any) => s.profile), ['elkjop']);
  assert.deepEqual(recorder.ticketJson('PM-2').sessions.map((s: any) => s.profile), ['elkjop-no']);

  // Once finished, the Work Profile can be closed again.
  assert.equal((await recorder.api('POST', '/api/profiles/close', { name: 'elkjop' })).status, 200);
  assert.deepEqual(await listed(), [['elkjop', false], ['elkjop-no', true]]);
});

test('a Ticket names the Work Profile it was last recorded with, which the page picker defaults to', async () => {
  const a = await open('elkjop');
  const b = await open('elkjop-no');
  assert.equal((await recorder.api('POST', '/api/tickets', { ticket: 'PM-1' })).body.lastProfile, null);

  await recordVisit('PM-1', b);
  assert.equal((await recorder.api('POST', '/api/stop')).status, 200);
  assert.equal((await recorder.api('POST', '/api/tickets', { ticket: 'PM-1' })).body.lastProfile, 'elkjop-no');
  await recordVisit('PM-1', a);
  assert.equal((await recorder.api('POST', '/api/stop')).status, 200);
  assert.equal((await recorder.api('POST', '/api/tickets', { ticket: 'PM-1' })).body.lastProfile, 'elkjop');

  const page = (await recorder.api('GET', '/')).body;
  assert.match(page, /<h2>Work Profiles<\/h2>/);
  assert.match(page, /id="create-profile"/);
  assert.match(page, /id="profile-select"/);
  assert.match(page, /lastProfile/, 'the picker defaults to the last-used Work Profile');
});
