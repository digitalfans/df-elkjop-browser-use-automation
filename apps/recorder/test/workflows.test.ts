// Workflows: the kind of work each Ticket is, chosen when it is recorded; she can add her own.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { launchChrome, startRecorder, type Chrome, type Recorder } from './harness.ts';

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

const INITIAL = ['Enriched Content', 'Virtual Categories', 'Campaign page localization', 'Banner publishing'];

async function ok(method: string, url: string, body?: unknown) {
  const res = await recorder.api(method, url, body);
  assert.equal(res.status, 200, res.body?.error);
  return res.body;
}

test('offers the four initial Workflows, Enriched Content by default', async () => {
  assert.deepEqual(await ok('GET', '/api/workflows'), { workflows: INITIAL, default: 'Enriched Content' });
});

test('a new Ticket gets the default Workflow, or the one chosen', async () => {
  assert.equal((await ok('POST', '/api/tickets', { ticket: 'PM-1' })).workflow, 'Enriched Content');
  assert.equal((await ok('POST', '/api/tickets', { ticket: 'PM-2', workflow: 'Banner publishing' })).workflow, 'Banner publishing');
  assert.equal(recorder.ticketJson('PM-2').workflow, 'Banner publishing');

  const unknown = await recorder.api('POST', '/api/tickets', { ticket: 'PM-3', workflow: 'Not a workflow' });
  assert.equal(unknown.status, 400);
  assert.match(unknown.body.error, /Unknown Workflow/);
  assert.ok(!fs.existsSync(path.join(recorder.recordingsDir, 'PM-3')), 'nothing created');

  // Opening an existing Ticket keeps its Workflow.
  assert.equal((await ok('POST', '/api/tickets', { ticket: 'PM-2', workflow: 'Virtual Categories' })).workflow, 'Banner publishing');
  const listed = (await ok('GET', '/api/tickets')).tickets;
  assert.deepEqual(listed.map((t: any) => [t.ticket, t.workflow]).sort(), [['PM-1', 'Enriched Content'], ['PM-2', 'Banner publishing']]);
});

test('changes a Ticket\'s Workflow, refused while it records', async () => {
  await ok('POST', '/api/tickets', { ticket: 'PM-1' });
  assert.equal((await ok('POST', '/api/tickets/workflow', { ticket: 'PM-1', workflow: 'Campaign page localization' })).workflow, 'Campaign page localization');
  assert.equal(recorder.ticketJson('PM-1').workflow, 'Campaign page localization');
  assert.equal((await recorder.api('POST', '/api/tickets/workflow', { ticket: 'PM-1', workflow: 'Nope' })).status, 400);
  assert.equal((await recorder.api('POST', '/api/tickets/workflow', { ticket: 'PM-9', workflow: 'Banner publishing' })).status, 404);

  const profile = await ok('POST', '/api/profiles', { name: 'elkjop' });
  chromes.push(await launchChrome(profile));
  await ok('POST', '/api/start', { ticket: 'PM-1', profile: 'elkjop' });
  const refused = await recorder.api('POST', '/api/tickets/workflow', { ticket: 'PM-1', workflow: 'Banner publishing' });
  assert.equal(refused.status, 409);
  await ok('POST', '/api/stop');
  assert.equal(recorder.ticketJson('PM-1').workflow, 'Campaign page localization');
});

test('adds new Workflows that persist across a restart, refusing blanks and duplicates', async () => {
  const added = await ok('POST', '/api/workflows', { name: '  Brand page update ' });
  assert.deepEqual(added.workflows, [...INITIAL, 'Brand page update']);

  for (const name of ['', '   ', 'enriched content', 'x'.repeat(61)]) {
    const res = await recorder.api('POST', '/api/workflows', { name });
    assert.equal(res.status, 400, `"${name.slice(0, 10)}" refused`);
  }

  await recorder.restart();
  assert.deepEqual((await ok('GET', '/api/workflows')).workflows, [...INITIAL, 'Brand page update']);
  assert.equal((await ok('POST', '/api/tickets', { ticket: 'PM-1', workflow: 'Brand page update' })).workflow, 'Brand page update');
});

test('the page offers the Workflow when creating and when a Ticket is open', async () => {
  const html = await (await fetch(recorder.url)).text();
  for (const id of ['new-workflow', 'ticket-workflow', 'add-workflow']) assert.match(html, new RegExp(`id="${id}"`), id);
});
