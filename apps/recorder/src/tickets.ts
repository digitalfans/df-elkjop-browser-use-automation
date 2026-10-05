// Ticket store: one folder per Ticket with ticket.json and an append-only timeline. The Ticket's zip
// exists only in the export folder, built at Export; keeping a copy next to the folder doubled disk use.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { config } from './config.ts';
import { badRequest, conflict, notFound } from './errors.ts';
import type { Event } from './events.ts';
import { readSettings } from './settings.ts';
import { checkWorkflow } from './workflows.ts';

const exec = promisify(execFile);

export type SessionSummary = {
  n: number; profile: string; startedAt: string; finishedAt: string; events: number;
  screenshots: number;
  annotations: number; // Steps, Checkpoints and Observations
  trace: string | null; // relative path of this Recording Session's Playwright trace
  errors: string[]; // what could not be captured, e.g. a screenshot of a tab that closed
  recovered?: true; // interrupted (crash, closed Terminal, restart) and closed from the events on disk at the next start
};
// The last time the Ticket was exported, and the zip it left in the export folder.
export type ExportSummary = { at: string; file: string };
export type Ticket = {
  ticket: string; briefing: string | null; createdAt: string; updatedAt: string; sessions: SessionSummary[];
  workflow: string | null; // the kind of work it is (see workflows.ts); null on Tickets from before 0.3.0
  lastExport: ExportSummary | null;
};

// What the history shows of a Ticket, besides the Ticket itself.
export type TicketSummary = Ticket & {
  dir: string;
  excerpt: string; // the Briefing on one line, shortened
  lastProfile: string | null; // the Work Profile it was last recorded with, which the picker offers first
  totals: { sessions: number; events: number; screenshots: number; annotations: number };
  size: number; // bytes on disk: the Ticket folder and its zip
};

// How much disk the Recordings use, and whether that is above the limit set in the settings (bytes).
export type DiskUsage = { total: number; limit: number; warning: boolean };

const GB = 1e9; // as Finder counts

const TIMELINE = 'timeline.jsonl';
const TICKET = 'ticket.json';
const EXCERPT = 140;

export const ticketDir = (id: string) => path.join(config.recordingsDir, id);
const ticketFile = (id: string) => path.join(ticketDir(id), TICKET);
const zipFile = (id: string) => `${ticketDir(id)}.zip`;

// A Ticket ID is also its folder name, so it can never point outside the recordings folder.
function checkId(id: string | undefined): string {
  if (!id || !/^[A-Za-z0-9][\w-]*$/.test(id)) throw badRequest('Ticket ID: letters, numbers, - and _ only (e.g. PM-32803)');
  return id;
}

export function readTicket(id: string | undefined): Ticket {
  const file = ticketFile(checkId(id));
  if (!fs.existsSync(file)) throw notFound(`Unknown Ticket ${id}`);
  return { lastExport: null, workflow: null, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
}

// Written to a temporary file and renamed, so a crash never leaves a half-written ticket.json.
// Recording an export is not an update: updatedAt later than lastExport means the export is outdated.
export function writeTicket(t: Ticket, { touch = true } = {}) {
  if (touch) t.updatedAt = new Date().toISOString();
  const file = ticketFile(t.ticket);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(t, null, 2));
  fs.renameSync(`${file}.tmp`, file);
}

function summary(t: Ticket): TicketSummary {
  t = { ...t, lastExport: t.lastExport ?? null, workflow: t.workflow ?? null };
  const sum = (k: 'events' | 'screenshots' | 'annotations') => t.sessions.reduce((n, s) => n + (s[k] ?? 0), 0);
  return {
    ...t,
    dir: ticketDir(t.ticket),
    excerpt: (t.briefing ?? '').replace(/\s+/g, ' ').trim().slice(0, EXCERPT),
    lastProfile: t.sessions.at(-1)?.profile ?? null,
    totals: { sessions: t.sessions.length, events: sum('events'), screenshots: sum('screenshots'), annotations: sum('annotations') },
    size: bytes(ticketDir(t.ticket)) + bytes(zipFile(t.ticket)), // the zip only exists if left by a version before 0.2.0
  };
}

// Bytes of every file under a folder, or of the file itself. Recording may add or remove files
// meanwhile (a zip being swapped in); whatever is gone by the time it is counted counts as 0.
function bytes(p: string): number {
  const st = fs.lstatSync(p, { throwIfNoEntry: false });
  if (!st?.isDirectory()) return st?.size ?? 0;
  let entries: string[];
  try {
    entries = fs.readdirSync(p);
  } catch {
    return 0;
  }
  return entries.reduce((n, name) => n + bytes(path.join(p, name)), 0);
}

// Only reads: the warning suggests exporting and deleting Tickets, it never deletes anything itself.
export function diskUsage(tickets: TicketSummary[]): DiskUsage {
  const total = tickets.reduce((n, t) => n + t.size, 0);
  const limit = Math.round(readSettings().diskLimitGB * GB);
  return { total, limit, warning: total > limit };
}

// Every Ticket on disk, the most recently updated first.
export function listTickets(): TicketSummary[] {
  if (!fs.existsSync(config.recordingsDir)) return [];
  const list: TicketSummary[] = [];
  for (const d of fs.readdirSync(config.recordingsDir, { withFileTypes: true })) {
    if (!d.isDirectory() || !fs.existsSync(ticketFile(d.name))) continue;
    try {
      list.push(summary(JSON.parse(fs.readFileSync(ticketFile(d.name), 'utf8'))));
    } catch (err) {
      console.error(`Skipping unreadable ${ticketFile(d.name)}:`, err);
    }
  }
  return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

// Typing an existing Ticket ID opens that Ticket instead of creating a duplicate, keeping its Workflow.
export function createOrOpenTicket(id: string | undefined, workflow?: string) {
  checkId(id);
  if (fs.existsSync(ticketFile(id!))) return { ...summary(readTicket(id)), existed: true };
  const chosen = checkWorkflow(workflow);
  fs.mkdirSync(ticketDir(id!), { recursive: true });
  const now = new Date().toISOString();
  const t: Ticket = { ticket: id!, briefing: null, workflow: chosen, createdAt: now, updatedAt: now, sessions: [], lastExport: null };
  writeTicket(t);
  return { ...summary(t), existed: false };
}

// An empty Briefing clears it. The caller refuses this while the Ticket records.
export function saveBriefing(id: string | undefined, briefing: string | undefined) {
  const t = readTicket(id);
  t.briefing = briefing?.trim() || null;
  writeTicket(t);
  return summary(t);
}

// The caller refuses this while the Ticket records.
export function saveWorkflow(id: string | undefined, workflow: string | undefined) {
  const t = readTicket(id);
  if (!workflow?.trim()) throw badRequest('Choose a Workflow');
  t.workflow = checkWorkflow(workflow);
  writeTicket(t);
  return summary(t);
}

// Moved to the Trash, not removed: a wrong click must be recoverable. The caller refuses this while
// the Ticket records.
export function deleteTicket(id: string | undefined) {
  const t = readTicket(id);
  fs.mkdirSync(config.trashDir, { recursive: true });
  const name = trashName(t.ticket);
  // Versions before 0.2.0 kept a zip next to the folder; it goes to the Trash with it.
  if (fs.existsSync(zipFile(t.ticket))) moveTo(zipFile(t.ticket), path.join(config.trashDir, `${name}.zip`));
  moveTo(ticketDir(t.ticket), path.join(config.trashDir, name));
}

// The Ticket ID and when it was deleted, never the name of something already in the Trash.
function trashName(id: string) {
  const base = `${id} ${new Date().toISOString().replace(/:/g, '.').replace('T', ' ').slice(0, 23)}`;
  let name = base;
  for (let i = 2; fs.existsSync(path.join(config.trashDir, name)) || fs.existsSync(path.join(config.trashDir, `${name}.zip`)); i++) name = `${base} ${i}`;
  return name;
}

function moveTo(from: string, to: string) {
  try {
    fs.renameSync(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    fs.cpSync(from, to, { recursive: true });
    fs.rmSync(from, { recursive: true, force: true });
  }
}

// Opens the Ticket's folder in Finder.
export async function revealTicket(id: string | undefined) {
  const t = readTicket(id);
  await exec('open', [ticketDir(t.ticket)]);
}

// Builds a zip of the Ticket straight into the export folder, which her SharePoint/OneDrive client
// syncs to the developer; the app itself never uploads anything. Each export is a new file named after
// the Ticket and the time, so re-exports never overwrite. The caller refuses this while the Ticket records.
export async function exportTicket(id: string | undefined) {
  const t = readTicket(id);
  const { exportDir } = readSettings();
  if (!exportDir) throw conflict('Set an export folder in the settings first');
  if (!fs.statSync(exportDir, { throwIfNoEntry: false })?.isDirectory()) {
    throw conflict(`The export folder ${exportDir} is not available: check that it is synced, or choose another one`);
  }
  try {
    fs.accessSync(exportDir, fs.constants.W_OK);
  } catch {
    throw conflict(`The export folder ${exportDir} is not writable: choose another one`);
  }
  const at = new Date();
  const file = exportName(exportDir, t.ticket, at);
  // Built under a hidden name and renamed, so the sync client never picks up half a zip.
  const partial = path.join(exportDir, `.${path.basename(file)}.partial`);
  fs.rmSync(partial, { force: true });
  try {
    await exec('/usr/bin/zip', ['-qr', partial, '.', '-x', `${TICKET}.tmp`], { cwd: ticketDir(t.ticket) });
    fs.renameSync(partial, file);
  } finally {
    fs.rmSync(partial, { force: true });
  }
  // Read again: the Briefing may have been saved while the zip was being built.
  const latest = readTicket(t.ticket);
  latest.lastExport = { at: at.toISOString(), file };
  writeTicket(latest, { touch: false });
  return summary(latest);
}

// <ticket>-<UTC time>.zip, with a counter when that name is taken (two exports in the same second).
function exportName(dir: string, id: string, at: Date) {
  const base = `${id}-${at.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  let file = path.join(dir, `${base}.zip`);
  for (let i = 2; fs.existsSync(file); i++) file = path.join(dir, `${base}-${i}.zip`);
  return file;
}

// A crash in the middle of an append can leave a last line without its newline; it is dropped, so the
// timeline stays one whole event per line and the next Recording Session appends after it cleanly.
export function repairTimeline(id: string) {
  const file = path.join(ticketDir(id), TIMELINE);
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  if (text && !text.endsWith('\n')) fs.truncateSync(file, Buffer.byteLength(text.slice(0, text.lastIndexOf('\n') + 1)));
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
