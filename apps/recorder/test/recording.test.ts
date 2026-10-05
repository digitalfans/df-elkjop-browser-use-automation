import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { launchChrome, startRecorder, waitFor, type Chrome, type Recorder } from './harness.ts';

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
  return { profile, chrome };
}

test('serves the recorder page and the demo page', async () => {
  const home = await recorder.api('GET', '/');
  assert.equal(home.status, 200);
  assert.match(home.body, /Ticket recorder/);
  const demo = await recorder.api('GET', '/demo');
  assert.equal(demo.status, 200);
  assert.match(demo.body, /Fake CMS component/);
});

test('registers and lists Work Profiles, open when a Chrome answers on their port', async () => {
  const { status, body: profile } = await recorder.api('POST', '/api/profiles', { name: 'elkjop' });
  assert.equal(status, 200);
  assert.equal(profile.name, 'elkjop');
  assert.equal(typeof profile.port, 'number');

  let list = (await recorder.api('GET', '/api/profiles')).body;
  assert.deepEqual(list.map((p: any) => [p.name, p.port, p.open]), [['elkjop', profile.port, false]]);

  chromes.push(await launchChrome(profile));
  list = (await recorder.api('GET', '/api/profiles')).body;
  assert.deepEqual(list.map((p: any) => [p.name, p.open]), [['elkjop', true]]);

  assert.equal((await recorder.api('POST', '/api/profiles', { name: 'elkjop' })).status, 409);
  assert.equal((await recorder.api('POST', '/api/profiles', { name: 'no spaces' })).status, 400);
});

test('records a Ticket end to end, each event on disk before the next', async () => {
  const { profile, chrome } = await openProfile('elkjop');
  const created = await recorder.api('POST', '/api/tickets', { ticket: 'PM-1' });
  assert.equal(created.status, 200);
  assert.equal(created.body.existed, false);

  const started = await recorder.api('POST', '/api/start', { ticket: 'PM-1', profile: 'elkjop' });
  assert.equal(started.status, 200, started.body.error);
  assert.equal((await recorder.api('GET', '/api/state')).body.status, 'recording');

  // The timeline must grow by exactly one line per action, while the session is still running.
  const lines = (n: number) => waitFor(`${n} timeline lines`, () => {
    const events = recorder.timeline('PM-1');
    assert.ok(events.length <= n, `expected ${n} events, got ${events.length}`);
    return events.length === n && events;
  });
  await lines(1);

  const page = await chrome.context.newPage();
  await page.goto(`${recorder.url}/demo`);
  await lines(3);
  const title = page.getByLabel('Page title');
  await title.click();
  await lines(4);
  await title.fill('RTX Spark');
  await title.blur();
  await lines(5);
  await page.getByLabel('Market').selectOption('SE');
  await lines(6);
  await page.getByRole('button', { name: 'Save' }).click();
  await lines(7);

  const live = (await recorder.api('GET', '/api/state')).body;
  assert.equal(live.eventCount, 7);
  assert.deepEqual(live.events.map((e: any) => e.type), ['start', 'tab-open', 'navigate', 'click', 'change', 'change', 'click']);

  const stopped = await recorder.api('POST', '/api/stop');
  assert.equal(stopped.status, 200, stopped.body.error);

  const events = recorder.timeline('PM-1');
  assert.deepEqual(
    events.map((e) => [e.seq, e.type, e.target?.locator, e.value]),
    [
      [1, 'start', undefined, undefined],
      [2, 'tab-open', undefined, undefined],
      [3, 'navigate', undefined, undefined],
      [4, 'click', "getByRole('textbox', { name: 'Page title' })", undefined],
      [5, 'change', "getByRole('textbox', { name: 'Page title' })", 'RTX Spark'],
      [6, 'change', "getByRole('combobox', { name: 'Market' })", 'SE'],
      [7, 'click', "getByRole('button', { name: 'Save' })", undefined],
      [8, 'stop', undefined, undefined],
    ],
  );
  for (const e of events) {
    assert.equal(e.session, 1);
    assert.equal(e.step, null);
    assert.equal(typeof e.t, 'number');
  }
  for (const e of events.slice(1, -1)) assert.equal(e.tab, events[1].tab);
  for (const e of events.slice(2, -1)) assert.equal(e.url, `${recorder.url}/demo`);
  assert.ok(events.every((e, i) => i === 0 || e.t >= events[i - 1].t), 't never goes back');

  const ticket = recorder.ticketJson('PM-1');
  assert.equal(ticket.sessions.length, 1);
  assert.equal(ticket.sessions[0].n, 1);
  assert.equal(ticket.sessions[0].profile, profile.name);
  assert.equal(ticket.sessions[0].events, 8);
  assert.equal((await recorder.api('GET', '/api/state')).body.status, 'idle');
});

test('refuses to start while recording, on a closed Work Profile, or for an unknown Ticket', async () => {
  await recorder.api('POST', '/api/tickets', { ticket: 'PM-2' });
  await recorder.api('POST', '/api/profiles', { name: 'closed' });
  await openProfile('elkjop');

  const closed = await recorder.api('POST', '/api/start', { ticket: 'PM-2', profile: 'closed' });
  assert.equal(closed.status, 409);
  assert.match(closed.body.error, /Work Profile closed is not open/);

  const unknown = await recorder.api('POST', '/api/start', { ticket: 'PM-404', profile: 'elkjop' });
  assert.equal(unknown.status, 404);
  assert.match(unknown.body.error, /Unknown Ticket PM-404/);

  assert.equal((await recorder.api('POST', '/api/stop')).status, 409);

  assert.equal((await recorder.api('POST', '/api/start', { ticket: 'PM-2', profile: 'elkjop' })).status, 200);
  const again = await recorder.api('POST', '/api/start', { ticket: 'PM-2', profile: 'elkjop' });
  assert.equal(again.status, 409);
  assert.match(again.body.error, /Already recording/);
  assert.equal((await recorder.api('POST', '/api/stop')).status, 200);
});

test('opens an existing Ticket instead of duplicating it', async () => {
  assert.equal((await recorder.api('POST', '/api/tickets', { ticket: 'PM-3' })).body.existed, false);
  assert.equal((await recorder.api('POST', '/api/tickets', { ticket: 'PM-3' })).body.existed, true);
  assert.equal((await recorder.api('POST', '/api/tickets', { ticket: '../etc' })).status, 400);
});
