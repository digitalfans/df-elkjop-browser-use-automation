// Workflows: the kinds of work a Ticket can be. Four to start with; the Copywriter can add her own.
// Kept in the recordings folder, like the settings, so replacing the app on update keeps them.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import { badRequest } from './errors.ts';

export const INITIAL_WORKFLOWS = ['Enriched Content', 'Virtual Categories', 'Campaign page localization', 'Banner publishing'];
export const DEFAULT_WORKFLOW = 'Enriched Content';
const MAX_NAME = 60;

const workflowsFile = () => path.join(config.recordingsDir, 'workflows.json');

export function listWorkflows() {
  return { workflows: readWorkflows(), default: DEFAULT_WORKFLOW };
}

function readWorkflows(): string[] {
  try {
    const added: unknown = JSON.parse(fs.readFileSync(workflowsFile(), 'utf8')).added;
    return [...INITIAL_WORKFLOWS, ...(Array.isArray(added) ? added.filter((w) => typeof w === 'string') : [])];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.error(`Ignoring unreadable ${workflowsFile()}:`, err);
    return [...INITIAL_WORKFLOWS];
  }
}

// Names are compared ignoring case, so "enriched content" never becomes a second Enriched Content.
export function addWorkflow(name: unknown) {
  const clean = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : '';
  if (!clean) throw badRequest('Workflow: type a name');
  if (clean.length > MAX_NAME) throw badRequest(`Workflow: at most ${MAX_NAME} characters`);
  const all = readWorkflows();
  if (all.some((w) => w.toLowerCase() === clean.toLowerCase())) throw badRequest(`Workflow ${clean} already exists`);
  const added = [...all.slice(INITIAL_WORKFLOWS.length), clean];
  const file = workflowsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify({ added }, null, 2));
  fs.renameSync(`${file}.tmp`, file);
  return listWorkflows();
}

// A Workflow given by the page, or the default when none is given.
export function checkWorkflow(workflow: string | undefined): string {
  if (workflow === undefined || workflow.trim() === '') return DEFAULT_WORKFLOW;
  const found = readWorkflows().find((w) => w === workflow.trim());
  if (!found) throw badRequest(`Unknown Workflow ${workflow}`);
  return found;
}
