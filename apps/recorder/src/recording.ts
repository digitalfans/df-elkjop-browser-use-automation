// Recording engine: attaches to a Work Profile over CDP (ADR 0001), injects the page logger and
// appends every event to the Ticket's timeline the moment it is recorded.
import fs from 'node:fs';
import type { Browser, BrowserContext, Page } from 'playwright';
import { conflict } from './errors.ts';
import type { Event, EventType } from './events.ts';
import { appendEvent, readTicket, readTimeline, writeTicket } from './tickets.ts';
import { getProfile, isOpen } from './work-profiles.ts';

const LOGGER = fs.readFileSync(new URL('./page-logger.js', import.meta.url), 'utf8');
const PAGE_EVENTS = new Set<EventType>(['click', 'change']);
const RECENT = 40;

type Session = {
  ticket: string;
  profile: string;
  n: number;
  startedAt: number;
  nextSeq: number;
  count: number;
  recent: Event[];
  browser: Browser;
  tabIds: WeakMap<Page, number>;
  nextTab: number;
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

function record(page: Page | null, ev: Pick<Event, 'type'> & Partial<Event>) {
  const s = session;
  if (status !== 'recording' || !s) return;
  const e: Event = { seq: s.nextSeq++, session: s.n, step: null, t: Date.now() - s.startedAt, tab: tabId(s, page), url: page?.url(), ...ev };
  appendEvent(s.ticket, e);
  s.count++;
  s.recent.push(e);
  if (s.recent.length > RECENT) s.recent.shift();
}

// What a page reports is only trusted for the fields it describes, never seq, session or timing.
function fromPage(page: Page, raw: unknown) {
  const ev = (raw ?? {}) as Partial<Event>;
  if (!ev.type || !PAGE_EVENTS.has(ev.type)) return;
  record(page, { type: ev.type, target: ev.target, value: ev.value });
}

async function attach(s: Session, page: Page) {
  tabId(s, page);
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
    const prior = readTimeline(t.ticket);
    const s: Session = {
      ticket: t.ticket, profile: profile.name, n: t.sessions.length + 1, startedAt: Date.now(),
      nextSeq: (prior.at(-1)?.seq ?? 0) + 1, count: 0, recent: [], browser, tabIds: new WeakMap(), nextTab: 1,
    };
    session = s;
    await context.exposeBinding('__recordEvent', ({ page }, ev) => fromPage(page, ev));
    await context.addInitScript(LOGGER);
    status = 'recording';
    record(null, { type: 'start' });
    for (const page of context.pages()) await attach(s, page);
    context.on('page', (page) => attach(s, page));
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
    await s.browser.close().catch(() => {}); // disconnects only; the Work Profile stays open
    const t = readTicket(s.ticket);
    t.sessions.push({
      n: s.n, profile: s.profile, startedAt: new Date(s.startedAt).toISOString(), finishedAt: new Date().toISOString(), events: s.count,
    });
    writeTicket(t);
  } finally {
    session = null;
    status = 'idle';
  }
}
