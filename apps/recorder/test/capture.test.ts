// Full semantic capture: what ends up in the timeline when the Copywriter works in her Work Profile.
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

// Waits until the timeline holds an event matching `match`, and returns it.
const recorded = (what: string, match: (e: any) => boolean) =>
  waitFor(what, () => recorder.timeline('PM-1').find(match));

test('records tabs opening and closing and main-frame navigations', async () => {
  await startRecording();
  const demo = `${recorder.url}/demo`;
  const page = await chrome.context.newPage();
  await page.goto(demo);
  await page.getByRole('link', { name: 'Next step' }).click();
  await page.waitForURL(`${demo}?step=2`);
  await recorded('the second navigation', (e) => e.type === 'navigate' && e.url === `${demo}?step=2`);
  await page.close();
  await recorded('the tab closing', (e) => e.type === 'tab-close');

  const events = await stopRecording();
  const opened = events.find((e) => e.type === 'tab-open');
  assert.ok(opened, 'tab-open recorded');
  const tab = opened.tab;
  assert.equal(typeof tab, 'number');
  const ofTab = events.filter((e) => e.tab === tab && e.type !== 'click');
  assert.deepEqual(ofTab.map((e) => [e.type, e.type === 'navigate' ? e.url : undefined]), [
    ['tab-open', undefined],
    ['navigate', demo],
    ['navigate', `${demo}?step=2`],
    ['tab-close', undefined],
  ]);
  const click = events.find((e) => e.type === 'click');
  assert.equal(click.target.locator, "getByRole('link', { name: 'Next step' })");
  assert.equal(click.tab, tab);
});

async function demoPage() {
  const page = await chrome.context.newPage();
  await page.goto(`${recorder.url}/demo`);
  return page;
}

test('records special keys and modifier shortcuts, not plain typing', async () => {
  await startRecording();
  const page = await demoPage();
  const title = page.getByLabel('Page title');
  await title.click();
  await page.keyboard.type('ab');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Meta+a');
  await page.keyboard.press('Control+Shift+K');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  await recorded('the Tab key', (e) => e.type === 'key' && e.key === 'Tab');

  const keys = (await stopRecording()).filter((e) => e.type === 'key');
  assert.deepEqual(keys.map((e) => [e.key, e.target.locator]), [
    ['Enter', "getByRole('textbox', { name: 'Page title' })"],
    ['Meta+a', "getByRole('textbox', { name: 'Page title' })"],
    ['Control+Shift+K', "getByRole('textbox', { name: 'Page title' })"],
    ['Escape', "getByRole('textbox', { name: 'Page title' })"],
    ['Tab', "getByRole('textbox', { name: 'Page title' })"],
  ]);
});

test('records a rich-text edit once typing pauses, with the settled text', async () => {
  await startRecording();
  const page = await demoPage();
  const teaser = page.getByLabel('Teaser text');
  await teaser.click();
  await page.keyboard.type('Upplev ');
  await page.keyboard.type('RTX Spark');
  const edit = await recorded('the edit', (e) => e.type === 'edit');
  assert.equal(edit.target.locator, "getByRole('textbox', { name: 'Teaser text' })");
  assert.equal(edit.value, 'Upplev RTX Spark');
  const events = await stopRecording();
  assert.equal(events.filter((e) => e.type === 'edit').length, 1, 'one edit per pause, not per keystroke');
});

test('records copy, cut and paste with the text involved', async () => {
  await startRecording();
  const page = await demoPage();
  await page.locator('#source').selectText();
  await page.keyboard.press('ControlOrMeta+c');
  const title = page.getByLabel('Page title');
  await title.click();
  await page.keyboard.press('ControlOrMeta+v');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+x');
  await recorded('the cut', (e) => e.type === 'cut');

  const source = 'Upplev nästa generations AI-prestanda med NVIDIA RTX Spark.';
  const clip = (await stopRecording()).filter((e) => ['copy', 'cut', 'paste'].includes(e.type));
  assert.deepEqual(clip.map((e) => [e.type, e.text, e.target.locator]), [
    ['copy', source, `getByText('${source}')`],
    ['paste', source, "getByRole('textbox', { name: 'Page title' })"],
    ['cut', source, "getByRole('textbox', { name: 'Page title' })"],
  ]);
});

test('masks password values, typed or pasted', async () => {
  await startRecording();
  const page = await demoPage();
  const title = page.getByLabel('Page title');
  await title.fill('hunter2');
  await title.press('ControlOrMeta+a');
  await title.press('ControlOrMeta+c');
  const password = page.getByLabel('Password');
  await password.click();
  await page.keyboard.press('ControlOrMeta+v');
  await password.blur();
  await recorded('the password change', (e) => e.type === 'change' && e.target.label === 'Password');

  const events = await stopRecording();
  const onPassword = events.filter((e) => e.target?.label === 'Password' && e.type !== 'click' && e.type !== 'key');
  assert.deepEqual(onPassword.map((e) => [e.type, e.text ?? e.value]), [
    ['paste', '••••••'],
    ['change', '••••••'],
  ]);
  const lines = JSON.stringify(events.filter((e) => e.target?.label === 'Password'));
  assert.ok(!lines.includes('hunter2'), 'the password never reaches the timeline');
});

test('records a click inside an iframe', async () => {
  await startRecording();
  const page = await demoPage();
  await page.frameLocator('iframe').getByRole('button', { name: 'Button inside iframe' }).click();
  const click = await recorded('the iframe click', (e) => e.type === 'click');
  assert.equal(click.target.locator, "getByRole('button', { name: 'Button inside iframe' })");
  assert.equal(click.url, `${recorder.url}/demo`);
  await stopRecording();
});

test('captures a page that was already open when recording started', async () => {
  const page = await demoPage();
  await startRecording();
  await page.getByRole('button', { name: 'Save' }).click();
  await page.frameLocator('iframe').getByRole('button', { name: 'Button inside iframe' }).click();
  await recorded('the iframe click', (e) => e.target?.name === 'Button inside iframe');
  const clicks = (await stopRecording()).filter((e) => e.type === 'click');
  assert.deepEqual(clicks.map((e) => [e.target.name, e.url]), [
    ['Save', `${recorder.url}/demo`],
    ['Button inside iframe', `${recorder.url}/demo`],
  ]);
  assert.equal(typeof clicks[0].tab, 'number');
});

test('does not record the recorder page open inside the Work Profile, but records the demo page', async () => {
  await startRecording();
  const ui = await chrome.context.newPage();
  await ui.goto(`${recorder.url}/`);
  await ui.getByRole('heading').first().click();
  await ui.keyboard.press('Enter');
  const page = await demoPage();
  await page.getByRole('button', { name: 'Save' }).click();
  await recorded('the demo click', (e) => e.type === 'click');

  const events = await stopRecording();
  const onUi = events.filter((e) => e.url?.startsWith(recorder.url) && !e.url.startsWith(`${recorder.url}/demo`));
  assert.deepEqual(onUi, []);
  assert.deepEqual(events.filter((e) => e.type === 'click').map((e) => e.target.name), ['Save']);
});

test('saves a screenshot shortly after each meaningful event, referenced from it', async () => {
  await startRecording();
  const page = await demoPage();
  const title = page.getByLabel('Page title');
  await title.fill('RTX Spark');
  await title.press('Escape');
  await title.press('Enter');
  await page.getByRole('button', { name: 'Save' }).click();
  await recorded('the click', (e) => e.type === 'click');

  const events = await stopRecording();
  const shot = (e: any) => [e.type, e.key, Boolean(e.screenshot)];
  assert.deepEqual(events.map(shot), [
    ['start', undefined, false],
    ['tab-open', undefined, true],
    ['navigate', undefined, true],
    ['key', 'Escape', false],
    ['key', 'Enter', true],
    ['change', undefined, true],
    ['click', undefined, true],
    ['stop', undefined, false],
  ]);
  for (const e of events.filter((x) => x.screenshot)) {
    assert.match(e.screenshot, /^screenshots\/.+\.png$/);
    const file = path.join(recorder.recordingsDir, 'PM-1', e.screenshot);
    assert.ok(fs.existsSync(file), `${e.screenshot} exists`);
    assert.ok(fs.statSync(file).size > 0, `${e.screenshot} is not empty`);
  }
  assert.equal(recorder.ticketJson('PM-1').sessions[0].screenshots, 5);
});

test('finishing a Recording Session leaves a Playwright trace for that session', async () => {
  await startRecording();
  const page = await demoPage();
  await page.getByRole('button', { name: 'Save' }).click();
  await recorded('the click', (e) => e.type === 'click');
  await stopRecording();

  const session = recorder.ticketJson('PM-1').sessions[0];
  assert.equal(session.trace, 'traces/session-1.zip');
  assert.deepEqual(session.errors, []);
  const file = path.join(recorder.recordingsDir, 'PM-1', session.trace);
  assert.ok(fs.existsSync(file), 'trace file exists');
  // A trace is a zip archive.
  assert.equal(fs.readFileSync(file).subarray(0, 2).toString(), 'PK');
});

test('names a <select> wrapped in its label by the label, not its option texts', async () => {
  await startRecording();
  const page = await demoPage();
  await page.getByLabel('Market').selectOption('SE');
  const change = await recorded('the select change', (e) => e.type === 'change');
  await stopRecording();
  assert.equal(change.value, 'SE');
  assert.equal(change.target.name, 'Market');
  assert.equal(change.target.label, 'Market');
  assert.equal(change.target.locator, "getByRole('combobox', { name: 'Market' })");
});
