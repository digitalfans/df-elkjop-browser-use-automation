// PROTOTYPE — throwaway. Question: can a recorder attach over CDP to a normal "work Chrome"
// (ADR 0001) and capture a Copywriter's manual session as semantic events, screenshots and a trace?
import http from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.RECORDER_PORT ?? 4317);
const FIRST_CDP_PORT = 9222;
const PROFILES = process.env.PROFILES_DIR ?? path.join(os.homedir(), 'playwright-profiles');
const PROFILE_META = '.recorder-profile.json';
const OUT = process.env.RECORDINGS_DIR ?? path.join(os.homedir(), 'playwright-recordings');
const TRASH = path.join(os.homedir(), '.Trash');
const here = (f) => new URL(f, import.meta.url);
const LOGGER = fs.readFileSync(here('./logger.js'), 'utf8');
const SCREENSHOT_ON = new Set(['click', 'change', 'edit', 'paste', 'navigate', 'tab-open', 'key', 'annotation']);
const ANNOTATION_KINDS = new Set(['step', 'checkpoint', 'observation']);
const RECORDER_UI = `http://localhost:${PORT}/`;

// `events` holds only the current Recording Session; `priorCount` is how many the Ticket already had.
// `step` is the Copywriter's latest Step annotation; every event is tagged with it.
const state = { status: 'idle', ticket: null, profile: null, port: null, session: null, dir: null, startedAt: null, tracing: null, priorCount: 0, step: null, lastPage: null, events: [], errors: [] };
let browser, context;
const tabIds = new WeakMap();
let nextTab = 1;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exec = promisify(execFile);
const now = () => new Date().toISOString();
const stamp = () => now().replace(/[:.]/g, '-').slice(0, 19);
const firstLine = (err) => err.message.split('\n')[0];

// Imported lazily so the server, and its setup checklist, can run before Playwright is installed.
async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    throw new Error('Playwright is not installed. Run the setup checklist.');
  }
}

// --- Setup checklist: everything a fresh Mac needs before it can record ---

const CHROME_APPS = ['/Applications/Google Chrome.app', path.join(os.homedir(), 'Applications', 'Google Chrome.app')];
const findChromeApp = () => CHROME_APPS.find((p) => fs.existsSync(p)) ?? null;
const chromeBinary = () => path.join(findChromeApp() ?? CHROME_APPS[0], 'Contents', 'MacOS', 'Google Chrome');

async function health() {
  const checks = [];
  const add = (id, label, ok, detail, action) => checks.push({ id, label, ok, detail, action });

  const major = Number(process.versions.node.split('.')[0]);
  add('node', 'Node.js', major >= 18, `${process.version} at ${process.execPath}`);

  const pwPkg = fileURLToPath(here('./node_modules/playwright/package.json'));
  const pw = readJson(pwPkg, null);
  add('playwright', 'Playwright', Boolean(pw), pw ? `version ${pw.version}` : 'Not installed in this folder.', pw ? undefined : 'install');

  const app = findChromeApp();
  let chromeDetail = 'Google Chrome is not in Applications. Install it from https://www.google.com/chrome and check again.';
  if (app) {
    const version = await exec('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', path.join(app, 'Contents', 'Info.plist')])
      .then((r) => r.stdout.trim()).catch(() => '?');
    chromeDetail = `version ${version} at ${app}`;
  }
  add('chrome', 'Google Chrome', Boolean(app), chromeDetail);

  add('zip', 'zip (part of macOS)', fs.existsSync('/usr/bin/zip'), fs.existsSync('/usr/bin/zip') ? '/usr/bin/zip' : 'Missing /usr/bin/zip.');

  let outOk = true;
  let outDetail = OUT;
  try {
    fs.mkdirSync(OUT, { recursive: true });
    fs.accessSync(OUT, fs.constants.W_OK);
  } catch (err) {
    outOk = false;
    outDetail = `${OUT}: ${firstLine(err)}`;
  }
  add('recordings', 'Recordings folder', outOk, outDetail);

  const profiles = await listProfiles();
  add('profile', 'Work Profile', profiles.length > 0,
    profiles.length ? profiles.map((p) => p.name).join(', ') : 'No Work Profile yet. Create one, then log in to the Elkjøp tools in it, by hand.',
    profiles.length ? undefined : 'create-profile');

  return { healthy: checks.every((c) => c.ok), checks };
}

async function installPlaywright() {
  const bin = path.dirname(process.execPath);
  const { stdout, stderr } = await exec(path.join(bin, 'npm'), ['install', '--no-audit', '--no-fund'], {
    cwd: fileURLToPath(here('./')),
    env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` }, // npm's shebang needs this node
    maxBuffer: 10 * 1024 * 1024,
  });
  return { log: `${stdout}${stderr}`.trim() };
}

// --- Work Profiles: dedicated Chromes, each on its own debugging port (ADR 0001) ---

const profileDir = (name) => path.join(PROFILES, name);

function adoptLegacyProfile() {
  // The first prototype used one unregistered `work-chrome` profile on 9222; keep its logins.
  const dir = profileDir('work-chrome');
  if (fs.existsSync(dir) && !fs.existsSync(path.join(dir, PROFILE_META))) {
    fs.writeFileSync(path.join(dir, PROFILE_META), JSON.stringify({ name: 'work-chrome', port: FIRST_CDP_PORT, createdAt: now() }, null, 2));
  }
}

function readProfiles() {
  if (!fs.existsSync(PROFILES)) return [];
  return fs.readdirSync(PROFILES, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(PROFILES, d.name, PROFILE_META)))
    .map((d) => readJson(path.join(PROFILES, d.name, PROFILE_META)))
    .sort((a, b) => a.port - b.port);
}

async function listProfiles() {
  return Promise.all(readProfiles().map(async (p) => ({ ...p, dir: profileDir(p.name), open: await chromeUp(p.port) })));
}

function getProfile(name) {
  const p = readProfiles().find((x) => x.name === name);
  if (!p) throw new Error(`unknown profile ${name}`);
  return p;
}

function createProfile(name) {
  if (!/^[\w-]+$/.test(name ?? '')) throw new Error('Profile name: letters, numbers, - and _ only');
  if (fs.existsSync(profileDir(name))) throw new Error(`A folder named ${name} already exists in ${PROFILES}`);
  const used = new Set(readProfiles().map((p) => p.port));
  let port = FIRST_CDP_PORT;
  while (used.has(port)) port++;
  fs.mkdirSync(profileDir(name), { recursive: true });
  const p = { name, port, createdAt: now() };
  fs.writeFileSync(path.join(profileDir(name), PROFILE_META), JSON.stringify(p, null, 2));
  return p;
}

// --- Tickets on disk: one folder per Ticket, all Recording Sessions in one timeline ---

const ticketDir = (id) => path.join(OUT, id.replace(/[^\w-]/g, '_'));
const readJson = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback);

function readTicket(id) {
  return readJson(path.join(ticketDir(id), 'ticket.json'), null);
}

function writeTicket(t) {
  const dir = ticketDir(t.ticket);
  t.updatedAt = now();
  fs.writeFileSync(path.join(dir, 'ticket.json'), JSON.stringify(t, null, 2));
  if (t.briefing) fs.writeFileSync(path.join(dir, 'briefing.txt'), t.briefing);
  else fs.rmSync(path.join(dir, 'briefing.txt'), { force: true });
}

function summary(t) {
  const sum = (k) => t.sessions.reduce((n, s) => n + s[k], 0);
  return {
    ...t,
    dir: ticketDir(t.ticket),
    excerpt: (t.briefing ?? '').replace(/\s+/g, ' ').slice(0, 140),
    totals: { sessions: t.sessions.length, events: sum('events'), screenshots: sum('screenshots'), annotations: t.sessions.reduce((n, s) => n + (s.annotations ?? 0), 0) },
    recording: state.status !== 'idle' && state.ticket === t.ticket,
  };
}

function listTickets() {
  if (!fs.existsSync(OUT)) return [];
  return fs.readdirSync(OUT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(OUT, d.name, 'ticket.json')))
    .map((d) => summary(readJson(path.join(OUT, d.name, 'ticket.json'))))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function createTicket(id, briefing) {
  if (!id) throw new Error('ticket is required');
  const existing = readTicket(id);
  if (existing) return { ...summary(existing), existed: true };
  fs.mkdirSync(path.join(ticketDir(id), 'screenshots'), { recursive: true });
  const t = { ticket: id, briefing: briefing || null, createdAt: now(), sessions: [] };
  writeTicket(t);
  return { ...summary(t), existed: false };
}

function assertNotRecording(id) {
  if (state.status !== 'idle' && state.ticket === id) throw new Error(`${id} is being recorded`);
}

function saveBriefing(id, briefing) {
  assertNotRecording(id);
  const t = readTicket(id);
  if (!t) throw new Error(`unknown ticket ${id}`);
  t.briefing = briefing || null;
  writeTicket(t);
  return summary(t);
}

function deleteTicket(id) {
  assertNotRecording(id);
  const dir = ticketDir(id);
  if (!fs.existsSync(dir)) throw new Error(`unknown ticket ${id}`);
  const name = `${path.basename(dir)}-${stamp()}`;
  fs.renameSync(dir, path.join(TRASH, name)); // the Trash, not rm: a wrong click must be recoverable
  if (fs.existsSync(`${dir}.zip`)) fs.renameSync(`${dir}.zip`, path.join(TRASH, `${name}.zip`));
}

// --- Work Chrome and recording ---

async function chromeUp(port) {
  try { return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok; } catch { return false; }
}

async function openProfile(name) {
  const { port } = getProfile(name);
  if (await chromeUp(port)) return;
  if (!findChromeApp()) throw new Error('Google Chrome is not installed');
  // A normal Chrome: real Keychain, no automation flags. The recorder only attaches over this port.
  spawn(chromeBinary(), [`--user-data-dir=${profileDir(name)}`, `--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check'],
    { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 60 && !(await chromeUp(port)); i++) await sleep(250);
  if (!(await chromeUp(port))) throw new Error(`${name} did not open its debugging port ${port}`);
}

async function closeProfile(name) {
  const { port } = getProfile(name);
  if (state.status !== 'idle' && state.profile === name) throw new Error(`${name} is being recorded`);
  if (!(await chromeUp(port))) return;
  const { chromium } = await loadPlaywright();
  const b = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const cdp = await b.newBrowserCDPSession();
  await cdp.send('Browser.close').catch(() => {}); // a regular quit, so cookies are flushed
  for (let i = 0; i < 40 && (await chromeUp(port)); i++) await sleep(250);
}

function tabId(page) {
  if (!page) return null;
  if (!tabIds.has(page)) tabIds.set(page, nextTab++);
  return tabIds.get(page);
}

async function record(page, ev) {
  if (state.status !== 'recording') return;
  // The recorder UI may be open in the work Chrome too; what she does there isn't part of her workflow.
  if (page?.url().startsWith(RECORDER_UI) && !page.url().startsWith(`${RECORDER_UI}demo`)) return;
  if (page) state.lastPage = page;
  const seq = state.priorCount + state.events.length + 1;
  const e = { seq, session: state.session, step: state.step?.n ?? null, t: Date.now() - state.startedAt, tab: tabId(page), url: page?.url(), ...ev };
  state.events.push(e);
  if (page && SCREENSHOT_ON.has(e.type) && !(e.type === 'key' && !e.key.endsWith('Enter'))) {
    await sleep(400); // let the page react, so the shot shows the result of the action
    const file = `screenshots/${String(e.seq).padStart(4, '0')}-${e.type}.png`;
    try {
      await page.screenshot({ path: path.join(state.dir, file), timeout: 3000 });
      e.screenshot = file;
    } catch (err) {
      state.errors.push(`screenshot #${e.seq}: ${firstLine(err)}`);
    }
  }
}

async function attach(page, opened) {
  tabId(page);
  if (opened) record(page, { type: 'tab-open' });
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) record(page, { type: 'navigate', url: frame.url() });
  });
  page.on('close', () => record(null, { type: 'tab-close', tab: tabId(page) }));
  // Pages already open when recording starts never see the init script, so inject it directly.
  for (const frame of page.frames()) await frame.evaluate(LOGGER).catch(() => {});
}

async function start(id, profileName) {
  if (state.status !== 'idle') throw new Error(`cannot start while ${state.status}`);
  const t = readTicket(id ?? '');
  if (!t) throw new Error(`unknown ticket ${id}`);
  const { port } = getProfile(profileName);
  if (!(await chromeUp(port))) throw new Error(`Work Profile ${profileName} is not open`);
  const { chromium } = await loadPlaywright();
  const dir = ticketDir(id);
  fs.mkdirSync(path.join(dir, 'screenshots'), { recursive: true });
  const prior = readJson(path.join(dir, 'events.json'), []);
  const lastStep = prior.findLast((e) => e.type === 'annotation' && e.kind === 'step');
  Object.assign(state, {
    status: 'recording', ticket: id, profile: profileName, port, session: t.sessions.length + 1, dir, startedAt: Date.now(), tracing: null,
    priorCount: prior.length, step: lastStep ? { n: lastStep.n, text: lastStep.text } : null, lastPage: null, events: [], errors: [],
  });

  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  context = browser.contexts()[0];
  await context.exposeBinding('__recordEvent', ({ page }, ev) => record(page, ev));
  await context.addInitScript(LOGGER);
  for (const page of context.pages()) await attach(page, false);
  context.on('page', (page) => attach(page, true));
  try {
    await context.tracing.start({ screenshots: true, snapshots: true });
    state.tracing = 'on';
  } catch (err) {
    state.tracing = `failed: ${firstLine(err)}`;
  }
  record(null, { type: 'start', tabs: context.pages().map((p) => ({ tab: tabId(p), url: p.url() })) });
}

// An annotation is the Copywriter's own words placed in the timeline at the moment she adds it.
async function annotate(kind, text) {
  if (state.status !== 'recording') throw new Error('annotations can only be added while recording');
  if (!ANNOTATION_KINDS.has(kind)) throw new Error(`unknown annotation kind ${kind}`);
  if (!text) throw new Error('annotation text is required');
  const extra = {};
  if (kind === 'step') {
    state.step = { n: (state.step?.n ?? 0) + 1, text };
    extra.n = state.step.n;
  }
  const page = state.lastPage && !state.lastPage.isClosed() ? state.lastPage : null;
  await record(page, { type: 'annotation', kind, text, ...extra });
}

async function stop() {
  if (state.status !== 'recording') throw new Error(`cannot stop while ${state.status}`);
  record(null, { type: 'stop' });
  state.status = 'finishing';
  const { ticket, session, dir, startedAt, events, errors } = state;
  if (state.tracing === 'on') {
    fs.mkdirSync(path.join(dir, 'traces'), { recursive: true });
    await context.tracing.stop({ path: path.join(dir, 'traces', `session-${session}.zip`) })
      .catch((err) => errors.push(`trace: ${firstLine(err)}`));
  }
  await browser.close().catch(() => {}); // disconnects only; the work Chrome stays open
  browser = context = undefined;
  state.lastPage = null;

  const eventsFile = path.join(dir, 'events.json');
  fs.writeFileSync(eventsFile, JSON.stringify([...readJson(eventsFile, []), ...events], null, 2));
  const t = readTicket(ticket);
  t.sessions.push({
    n: session, profile: state.profile, startedAt: new Date(startedAt).toISOString(), finishedAt: now(), tracing: state.tracing,
    events: events.length, screenshots: events.filter((e) => e.screenshot).length,
    annotations: events.filter((e) => e.type === 'annotation').length, errors,
  });
  writeTicket(t);

  fs.rmSync(`${dir}.zip`, { force: true });
  await exec('zip', ['-qr', `${dir}.zip`, '.'], { cwd: dir });
  state.status = 'idle';
}

// --- HTTP ---

const routes = {
  'GET /': (_, res) => send(res, 200, fs.readFileSync(here('./index.html')), 'text/html'),
  'GET /demo': (_, res) => send(res, 200, fs.readFileSync(here('./demo.html')), 'text/html'),
  'GET /api/state': () => ({ ...state, lastPage: undefined, out: OUT, profilesDir: PROFILES, events: state.events.slice(-40), eventCount: state.events.length }),
  'GET /api/health': () => health(),
  'POST /api/setup/install': () => installPlaywright(),
  'GET /api/profiles': () => listProfiles(),
  'POST /api/profiles': (body) => createProfile(body.name?.trim()),
  'POST /api/profiles/open': (body) => openProfile(body.name),
  'POST /api/profiles/close': (body) => closeProfile(body.name),
  'GET /api/tickets': () => listTickets(),
  'POST /api/tickets': (body) => createTicket(body.ticket?.trim(), body.briefing?.trim()),
  'POST /api/tickets/briefing': (body) => saveBriefing(body.ticket, body.briefing?.trim()),
  'POST /api/tickets/delete': (body) => deleteTicket(body.ticket),
  'POST /api/start': (body) => start(body.ticket, body.profile),
  'POST /api/stop': () => stop(),
  'POST /api/annotate': (body) => annotate(body.kind, body.text?.trim()),
  'POST /api/reveal': (body) => exec('open', [body.ticket ? ticketDir(body.ticket) : OUT]),
};

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'content-type': type });
  res.end(type === 'application/json' ? JSON.stringify(body ?? { ok: true }) : body);
}

adoptLegacyProfile();

http.createServer(async (req, res) => {
  const route = routes[`${req.method} ${req.url.split('?')[0]}`];
  if (!route) return send(res, 404, { error: 'not found' });
  let raw = '';
  for await (const chunk of req) raw += chunk;
  try {
    const out = await route(raw ? JSON.parse(raw) : {}, res);
    if (!res.headersSent) send(res, 200, out);
  } catch (err) {
    state.errors.push(err.message);
    if (state.status === 'finishing') state.status = 'idle';
    send(res, 500, { error: err.message });
  }
}).listen(PORT, '127.0.0.1', () => console.log(`Recorder prototype on http://localhost:${PORT}`));
