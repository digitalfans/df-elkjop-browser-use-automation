// Recording engine: attaches to a Work Profile over CDP (ADR 0001), injects the page logger and
// appends every event to the Ticket's timeline the moment it is recorded.
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Browser, BrowserContext, Page } from 'playwright';
import { config } from './config.ts';
import { conflict } from './errors.ts';
import type { Event, EventType } from './events.ts';
import { appendEvent, readTicket, readTimeline, ticketDir, writeTicket } from './tickets.ts';
import { getProfile, isOpen } from './work-profiles.ts';

const LOGGER = fs.readFileSync(new URL('./page-logger.js', import.meta.url), 'utf8');
const PAGE_EVENTS = new Set<EventType>(['click', 'change', 'edit', 'key', 'copy', 'cut', 'paste']);
const RECENT = 40;
// Events whose result is worth seeing; a key only when it is Enter, the one that usually submits something.
const SCREENSHOT_ON = new Set<EventType>(['click', 'change', 'edit', 'paste', 'navigate', 'tab-open', 'key', 'annotation']);
const SCREENSHOT_DELAY = 400; // let the page react, so the shot shows the result of the action

type Session = {
  ticket: string;
  profile: string;
  n: number;
  startedAt: number;
  nextSeq: number;
  count: number;
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

export function recordingState() {
  return {
    status,
    ticket: session?.ticket ?? null,
    profile: session?.profile ?? null,
    session: session?.n ?? null,
    startedAt: session?.startedAt ?? null,
    eventCount: session?.count ?? 0,
    events: session?.recent ?? [],
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
  const e: Event = { seq: s.nextSeq++, session: s.n, step: null, t: Date.now() - s.startedAt, tab: tabId(s, page), url: page?.url(), ...ev };
  // The event names its screenshot as it is written, so it is on disk now; the shot follows shortly.
  if (page && SCREENSHOT_ON.has(e.type) && (e.type !== 'key' || e.key?.endsWith('Enter'))) {
    e.screenshot = `screenshots/${String(e.seq).padStart(5, '0')}-${e.type}.png`;
    screenshot(s, page, e.seq, e.screenshot);
  }
  appendEvent(s.ticket, e);
  s.count++;
  s.recent.push(e);
  if (s.recent.length > RECENT) s.recent.shift();
}

function screenshot(s: Session, page: Page, seq: number, file: string) {
  const shot = (async () => {
    await sleep(SCREENSHOT_DELAY);
    try {
      await page.screenshot({ path: path.join(ticketDir(s.ticket), file), timeout: 3000 });
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
  let browser: Browser | undefined;
  try {
    if (!(await isOpen(profile.port))) throw conflict(`Work Profile ${profile.name} is not open`);
    const { chromium } = await import('playwright');
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${profile.port}`);
    const context: BrowserContext = browser.contexts()[0];
    fs.mkdirSync(path.join(ticketDir(t.ticket), 'screenshots'), { recursive: true });
    const prior = readTimeline(t.ticket);
    const s: Session = {
      ticket: t.ticket, profile: profile.name, n: t.sessions.length + 1, startedAt: Date.now(),
      nextSeq: (prior.at(-1)?.seq ?? 0) + 1, count: 0, recent: [], browser, context, tracing: false, tabIds: new WeakMap(), nextTab: 1,
      screenshots: 0, pending: new Set(), errors: [],
    };
    session = s;
    // Background for the developer: filmstrip, DOM snapshots, network and console.
    try {
      await context.tracing.start({ screenshots: true, snapshots: true });
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
    session = null;
    status = 'idle';
    throw err;
  }
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
      screenshots: s.screenshots, trace, errors: s.errors,
    });
    writeTicket(t);
  } finally {
    session = null;
    status = 'idle';
  }
}
