// HTTP API and the recorder page. JSON in and out, body-based routes.
import fs from 'node:fs';
import http from 'node:http';
import { config } from './config.ts';
import { HttpError, badRequest } from './errors.ts';
import { annotate, assertNotRecorded, assertTicketNotRecorded, isRecordingTicket, recordingState, start, stop } from './recording.ts';
import { dismissRecoveryNotices, recoverInterrupted } from './recovery.ts';
import { readSettings, saveSettings } from './settings.ts';
import { createOrOpenTicket, deleteTicket, diskUsage, exportTicket, listTickets, revealTicket, saveBriefing } from './tickets.ts';
import { closeProfile, createProfile, listProfiles, openProfile } from './work-profiles.ts';

type Body = Record<string, string | undefined>;
type Route = (body: Body) => unknown;

const page = (file: string) => fs.readFileSync(new URL(`../public/${file}`, import.meta.url));
const trimmed = (s: string | undefined) => (typeof s === 'string' ? s.trim() : undefined);

const pages: Record<string, string> = { '/': 'index.html', '/demo': 'demo.html' };

const routes: Record<string, Route> = {
  'GET /api/state': () => ({ ...recordingState(), recordingsDir: config.recordingsDir, profilesDir: config.profilesDir }),
  'GET /api/profiles': () => listProfiles(),
  'POST /api/profiles': (body) => createProfile(trimmed(body.name)),
  'POST /api/profiles/open': (body) => openProfile(body.name),
  'POST /api/profiles/close': (body) => {
    assertNotRecorded(body.name);
    return closeProfile(body.name);
  },
  'GET /api/tickets': () => {
    const tickets = listTickets();
    return { tickets: tickets.map((t) => ({ ...t, recording: isRecordingTicket(t.ticket) })), disk: diskUsage(tickets) };
  },
  'POST /api/tickets': (body) => createOrOpenTicket(trimmed(body.ticket)),
  'POST /api/tickets/briefing': (body) => {
    assertTicketNotRecorded(body.ticket);
    return saveBriefing(body.ticket, body.briefing);
  },
  'POST /api/tickets/delete': (body) => {
    assertTicketNotRecorded(body.ticket);
    return deleteTicket(body.ticket);
  },
  'POST /api/tickets/reveal': (body) => revealTicket(body.ticket),
  'POST /api/tickets/export': (body) => {
    assertTicketNotRecorded(body.ticket);
    return exportTicket(body.ticket);
  },
  'GET /api/settings': () => readSettings(),
  'POST /api/settings': (body) => saveSettings(body),
  'POST /api/start': (body) => start(body.ticket, body.profile),
  'POST /api/stop': () => stop(),
  'POST /api/annotate': (body) => annotate(body.kind, body.text),
  'POST /api/recovery/dismiss': () => dismissRecoveryNotices(),
};

function send(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body ?? { ok: true }));
}

async function readBody(req: http.IncomingMessage): Promise<Body> {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw badRequest('Request body is not valid JSON');
  }
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (req.method === 'GET' && pages[pathname]) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(page(pages[pathname]));
  }
  const route = routes[`${req.method} ${pathname}`];
  if (!route) return send(res, 404, { error: 'Not found' });
  try {
    send(res, 200, await route(await readBody(req)));
  } catch (err) {
    if (err instanceof HttpError) return send(res, err.status, { error: err.message });
    console.error(err);
    send(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

// An interrupted Recording Session is closed before anything can start a new one.
await recoverInterrupted();
server.listen(config.port, '127.0.0.1', () => console.log(`Recorder on http://localhost:${config.port}`));
