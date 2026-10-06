// Recording engine: attaches to a Work Profile over CDP (ADR 0001), injects the page logger and
// appends every event to the Ticket's timeline the moment it is recorded.
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Browser, BrowserContext, Page } from 'playwright';
import { config } from './config.ts';
import { badRequest, conflict } from './errors.ts';
import type { AnnotationKind, Event, EventType } from './events.ts';
import { appendEvent, readTicket, readTimeline, ticketDir, writeTicket } from './tickets.ts';
import { clearOpen, markOpen, recoveryNotices } from './recovery.ts';
import { loadPlaywright } from './setup.ts';
import { getProfile, isOpen } from './work-profiles.ts';

const LOGGER = fs.readFileSync(new URL('./page-logger.js', import.meta.url), 'utf8');
const PAGE_EVENTS = new Set<EventType>(['click', 'change', 'edit', 'key', 'copy', 'cut', 'paste']);
const RECENT = 40;
// Events whose result is worth seeing; a key only when it is Enter, the one that usually submits something.
const SCREENSHOT_ON = new Set<EventType>(['click', 'change', 'edit', 'paste', 'navigate', 'tab-open', 'key', 'annotation']);
const SCREENSHOT_DELAY = 400; // let the page react, so the shot shows the result of the action
const ANNOTATION_KINDS = new Set<string>(['step', 'checkpoint', 'observation'] satisfies AnnotationKind[]);

type Session = {
  ticket: string;
  profile: string;
  n: number;
  startedAt: number;
  nextSeq: number;
  count: number;
  annotations: number;
  // The latest Step annotation, in this or an earlier Recording Session; every event is tagged with it.
  step: { n: number; text: string } | null;
  // The tab she was last on, which an Annotation's screenshot shows.
  lastPage: Page | null;
  recent: Event[];
  browser: Browser;
  context: BrowserContext;
  tracing: boolean;
  tabIds: WeakMap<Page, number>;
  nextTab: number;
  screenshots: number;
  pending: Set<Promise<void>>;
  errors: string[];
};

let status: 'idle' | 'starting' | 'recording' | 'finishing' = 'idle';
let session: Session | null = null;
// The Work Profile and Ticket in use from the moment start begins until the Recording Session is finished.
let attached: string | null = null;
let recordedTicket: string | null = null;

// The Work Profile being recorded cannot be closed: that would break the Recording Session.
export function assertNotRecorded(profileName: string | undefined) {
  if (attached && attached === profileName) throw conflict(`${attached} is being recorded: finish the Recording Session first`);
}

// Nor can the Ticket being recorded be edited or deleted: that would corrupt the Recording.
export function assertTicketNotRecorded(ticketId: string | undefined) {
  if (recordedTicket && recordedTicket === ticketId) throw conflict(`${recordedTicket} is being recorded: finish the Recording Session first`);
}

export const isRecordingTicket = (ticketId: string) => recordedTicket === ticketId;

export function recordingState() {
  return {
    status,
    ticket: session?.ticket ?? null,
    profile: session?.profile ?? null,
    session: session?.n ?? null,
    startedAt: session?.startedAt ?? null,
    step: session?.step ?? null,
    eventCount: session?.count ?? 0,
    events: session?.recent ?? [],
    recovered: recoveryNotices(),
  };
}

function tabId(s: Session, page: Page | null) {
  if (!page) return null;
  if (!s.tabIds.has(page)) s.tabIds.set(page, s.nextTab++);
  return s.tabIds.get(page)!;
}

// The recorder page may be open in the Work Profile too; what she does there isn't part of her workflow.
// The demo page it serves is a stand-in for a real tool, so it is still recorded.
function isRecorderPage(url: string | undefined) {
  if (!url) return false;
  try {
    const u = new URL(url);
    return ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) && Number(u.port) === config.port && u.pathname !== '/demo';
  } catch {
    return false;
  }
}

function record(page: Page | null, ev: Pick<Event, 'type'> & Partial<Event>) {
  const s = session;
  if (status !== 'recording' || !s) return;
  if (isRecorderPage(page?.url()) || isRecorderPage(ev.url)) return;
  if (page) s.lastPage = page;
  const e: Event = { seq: s.nextSeq++, session: s.n, step: s.step?.n ?? null, t: Date.now() - s.startedAt, tab: tabId(s, page), url: page?.url(), ...ev };
  // The event names its screenshot as it is written, so it is on disk now; the shot follows shortly.
  if (page && SCREENSHOT_ON.has(e.type) && (e.type !== 'key' || e.key?.endsWith('Enter'))) {
    e.screenshot = `screenshots/${String(e.seq).padStart(5, '0')}-${e.type}.jpg`;
    screenshot(s, page, e.seq, e.screenshot);
  }
  appendEvent(s.ticket, e);
  s.count++;
  if (e.type === 'annotation') s.annotations++;
  s.recent.push(e);
  if (s.recent.length > RECENT) s.recent.shift();
}

function screenshot(s: Session, page: Page, seq: number, file: string) {
  const shot = (async () => {
    await sleep(SCREENSHOT_DELAY);
    try {
      // At 1 CSS pixel per pixel: on a Retina Mac a device-pixel shot has 4× the pixels for the same information.
      // JPEG at 70: on Elgiganten pages full of product photos it is ~3.5× smaller than PNG, text still sharp.
      await page.screenshot({ path: path.join(ticketDir(s.ticket), file), timeout: 3000, scale: 'css', type: 'jpeg', quality: 70 });
      s.screenshots++;
    } catch (err) {
      s.errors.push(`screenshot #${seq}: ${firstLine(err)}`);
    }
  })();
  s.pending.add(shot);
  shot.finally(() => s.pending.delete(shot));
}

const firstLine = (err: unknown) => (err instanceof Error ? err.message : String(err)).split('\n')[0];

// What a page reports is only trusted for the fields it describes, never seq, session or timing.
function fromPage(page: Page, raw: unknown) {
  const ev = (raw ?? {}) as Partial<Event>;
  if (!ev.type || !PAGE_EVENTS.has(ev.type)) return;
  record(page, { type: ev.type, target: ev.target, value: ev.value, text: ev.text, key: ev.key });
}

async function attach(s: Session, page: Page, opened: boolean) {
  tabId(s, page);
  if (opened) record(page, { type: 'tab-open' });
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) record(page, { type: 'navigate', url: frame.url() });
  });
  page.on('close', () => record(page, { type: 'tab-close' }));
  // Pages already open when recording starts never see the init script, so inject it directly.
  for (const frame of page.frames()) await frame.evaluate(LOGGER).catch(() => {});
}

export async function start(ticketId: string | undefined, profileName: string | undefined) {
  if (status !== 'idle') throw conflict(`Already ${status}: finish the current Recording Session first`);
  const t = readTicket(ticketId ?? '');
  const profile = getProfile(profileName ?? '');
  status = 'starting';
  attached = profile.name;
  recordedTicket = t.ticket;
  let browser: Browser | undefined;
  try {
    if (!(await isOpen(profile.port))) throw conflict(`Work Profile ${profile.name} is not open`);
    const { chromium } = await loadPlaywright();
    // noDefaults: without it Playwright takes over her downloads, saving them under a GUID name in a
    // temp folder it deletes on disconnect, so the file shows in Chrome but never opens.
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${profile.port}`, { noDefaults: true });
    const context: BrowserContext = browser.contexts()[0];
    fs.mkdirSync(path.join(ticketDir(t.ticket), 'screenshots'), { recursive: true });
    const prior = readTimeline(t.ticket);
    // Numbering continues across Recording Sessions: she starts in the last Step of the previous one.
    const lastStep = prior.findLast((e) => e.type === 'annotation' && e.kind === 'step');
    const s: Session = {
      ticket: t.ticket, profile: profile.name, n: t.sessions.length + 1, startedAt: Date.now(),
      nextSeq: (prior.at(-1)?.seq ?? 0) + 1, count: 0, annotations: 0,
      step: lastStep?.n ? { n: lastStep.n, text: lastStep.text ?? '' } : null, lastPage: null, recent: [], browser, context, tracing: false, tabIds: new WeakMap(), nextTab: 1,
      screenshots: 0, pending: new Set(), errors: [],
    };
    session = s;
    // From here on, a crash leaves this marker behind and the next start recovers the Recording Session.
    markOpen({ ticket: s.ticket, profile: s.profile, n: s.n, startedAt: new Date(s.startedAt).toISOString() });
    // Background for the developer: DOM snapshots, network and console. No screencast: it duplicated the
    // per-event screenshots and was most of a trace's size.
    try {
      await context.tracing.start({ screenshots: false, snapshots: true });
      s.tracing = true;
    } catch (err) {
      s.errors.push(`trace: ${firstLine(err)}`);
    }
    await context.exposeBinding('__recordEvent', ({ page }, ev) => fromPage(page, ev));
    await context.addInitScript(LOGGER);
    status = 'recording';
    record(null, { type: 'start' });
    for (const page of context.pages()) await attach(s, page, false);
    context.on('page', (page) => attach(s, page, true));
  } catch (err) {
    await browser?.close().catch(() => {});
    if (session) clearOpen();
    session = null;
    attached = null;
    recordedTicket = null;
    status = 'idle';
    throw err;
  }
}

// An Annotation is the Copywriter's own words placed in the timeline at the moment she adds it, with a
// screenshot of the tab she was last on. A Step is numbered after the previous one and becomes current.
export function annotate(kind: string | undefined, text: string | undefined) {
  const s = session;
  if (status !== 'recording' || !s) throw conflict('Annotations can only be added while recording');
  if (!kind || !ANNOTATION_KINDS.has(kind)) throw badRequest(`Unknown Annotation kind ${kind}: step, checkpoint or observation`);
  const words = typeof text === 'string' ? text.trim() : '';
  if (!words) throw badRequest('An Annotation needs some text');
  const ev: Partial<Event> & Pick<Event, 'type'> = { type: 'annotation', kind: kind as AnnotationKind, text: words };
  if (kind === 'step') {
    s.step = { n: (s.step?.n ?? 0) + 1, text: words };
    ev.n = s.step.n;
  }
  // A tab she closed, or one now showing the recorder page, has nothing of her work to show.
  const last = s.lastPage;
  const page = last && !last.isClosed() && !isRecorderPage(last.url()) ? last : null;
  record(page, ev);
}

export async function stop() {
  const s = session;
  if (status !== 'recording' || !s) throw conflict(`Not recording`);
  record(null, { type: 'stop' });
  status = 'finishing';
  try {
    await Promise.all(s.pending);
    let trace: string | null = null;
    if (s.tracing) {
      const file = `traces/session-${s.n}.zip`;
      try {
        await s.context.tracing.stop({ path: path.join(ticketDir(s.ticket), file) });
        trace = file;
      } catch (err) {
        s.errors.push(`trace: ${firstLine(err)}`);
      }
    }
    await s.browser.close().catch(() => {}); // disconnects only; the Work Profile stays open
    const t = readTicket(s.ticket);
    t.sessions.push({
      n: s.n, profile: s.profile, startedAt: new Date(s.startedAt).toISOString(), finishedAt: new Date().toISOString(), events: s.count,
      screenshots: s.screenshots, annotations: s.annotations, trace, errors: s.errors,
    });
    writeTicket(t);
    clearOpen();
  } finally {
    session = null;
    attached = null;
    recordedTicket = null;
    status = 'idle';
  }
}
