// Ticket store: one folder per Ticket with ticket.json and an append-only timeline.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import { badRequest, notFound } from './errors.ts';
import type { Event } from './events.ts';

export type SessionSummary = {
  n: number; profile: string; startedAt: string; finishedAt: string; events: number;
  screenshots: number;
  trace: string | null; // relative path of this Recording Session's Playwright trace
  errors: string[]; // what could not be captured, e.g. a screenshot of a tab that closed
};
export type Ticket = { ticket: string; briefing: string | null; createdAt: string; updatedAt: string; sessions: SessionSummary[] };

const TIMELINE = 'timeline.jsonl';

export const ticketDir = (id: string) => path.join(config.recordingsDir, id);

export function readTicket(id: string): Ticket {
  const file = path.join(ticketDir(id), 'ticket.json');
  if (!fs.existsSync(file)) throw notFound(`Unknown Ticket ${id}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function writeTicket(t: Ticket) {
  t.updatedAt = new Date().toISOString();
  fs.writeFileSync(path.join(ticketDir(t.ticket), 'ticket.json'), JSON.stringify(t, null, 2));
}

// Typing an existing Ticket ID opens that Ticket instead of creating a duplicate.
export function createOrOpenTicket(id: string | undefined) {
  if (!id || !/^[A-Za-z0-9][\w-]*$/.test(id)) throw badRequest('Ticket ID: letters, numbers, - and _ only (e.g. PM-32803)');
  if (fs.existsSync(path.join(ticketDir(id), 'ticket.json'))) return { ...readTicket(id), existed: true };
  fs.mkdirSync(ticketDir(id), { recursive: true });
  const now = new Date().toISOString();
  const t: Ticket = { ticket: id, briefing: null, createdAt: now, updatedAt: now, sessions: [] };
  writeTicket(t);
  return { ...t, existed: false };
}

export function readTimeline(id: string): Event[] {
  const file = path.join(ticketDir(id), TIMELINE);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

// Synchronous on purpose: the event is on disk before anything else is recorded.
export function appendEvent(id: string, e: Event) {
  fs.appendFileSync(path.join(ticketDir(id), TIMELINE), `${JSON.stringify(e)}\n`);
}
