'use strict';

/**
 * #5153 slice 1: a change receipt for a closed task. For each agent that held a part of it: the files it created or
 * edited, how many shell commands it ran (a COUNT, never their text: listing commands is Josh's call, the report hook
 * keeps none), the tokens it used per model, and how many times the task was put back or handed on. No undo (also his
 * call): the receipt names the agent's folder and the files, so a person knows where to look.
 *
 * 🔑 NOT IN THE CLOSE PATH. The receipt is worked out when the task page asks for it, from two things Kosmos already
 * keeps: the task's own activity (engine/taskchat.js, which says who held which part and when) and the agent's Claude
 * Code transcripts. Closing a task, which a new user does on day one, is unchanged. Once a task has been closed for
 * SETTLE_MS (its transcripts are flushed), the receipt is kept on disk keyed by the close time, so it is read once.
 *
 * WHOSE WORK, AND WHEN. An agent's work counts only while it held a part: from being given it (a task created with it,
 * a part assigned to it or added for it) until the part is handed on or closed, or the task is closed; putting the task
 * or the part back starts the hold again. Overlapping holds merge. Work the agent did on something else inside a hold
 * is included, and the page says so: a session is not split by task.
 *
 * Claude only in this slice. An agent on another provider (create.recordedRunner) is listed with `available: false`,
 * never a guessed zero. Four token buckets per model, never blended; one assistant message counted once by its id, and
 * synthetic rows skipped, as engine/usage.js counts them.
 */

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const store = require('./store');
const taskchat = require('./taskchat');

const DIRNAME = 'task-receipts';
const SETTLE_MS = 5 * 60 * 1000;
const FILES_SHOWN = 40;
const BUCKET_FIELDS = ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'];
const SYNTHETIC_ROW = /"model":"<[^"]*>"/;
const FILE_TOOLS = { Edit: 'file_path', Write: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' };
const COMMAND_TOOLS = new Set(['Bash']);
/* Bumped when the receipt's shape or counting changes, so a kept receipt from an older build is worked out again. */
const VERSION = 1;

/**
 * Each agent's holds on the task, from its activity rows (oldest first): { [who]: [{ from, to }] } in ms, merged.
 * `closedAt` ends every hold still open. Pure.
 */
function holdsFrom(events, closedAt) {
  const holder = new Map();     // partId -> { who, since } while the part is held and open
  const lastWho = new Map();    // partId -> who, kept through a close so a put-back resumes it
  const out = {};
  const end = (partId, at) => {
    const h = holder.get(partId);
    if (!h) return;
    holder.delete(partId);
    if (at > h.since) (out[h.who] = out[h.who] || []).push({ from: h.since, to: at });
  };
  const start = (partId, who, at) => {
    end(partId, at);
    if (typeof who === 'string' && who) { holder.set(partId, { who, since: at }); lastWho.set(partId, who); }
    else lastWho.delete(partId);
  };
  let taskOpen = true;
  const closedParts = new Set();
  for (const ev of Array.isArray(events) ? events : []) {
    const at = Date.parse(ev && ev.at);
    if (!Number.isFinite(at)) continue;
    const part = ev.partId == null ? 1 : Number(ev.partId);   // a row from before parts named the task's one part
    switch (ev.kind) {
      case 'created':
        if (ev.who) start(1, ev.who, at);
        break;
      case 'part-added':
        if (ev.who) start(part, ev.who, at); else lastWho.delete(part);
        break;
      case 'assigned':
        if (taskOpen && !closedParts.has(part)) start(part, ev.who, at);
        else { end(part, at); if (typeof ev.who === 'string' && ev.who) lastWho.set(part, ev.who); else lastWho.delete(part); }
        break;
      case 'part-closed':
        closedParts.add(part);
        end(part, at);
        break;
      case 'part-reopened':
        closedParts.delete(part);
        if (taskOpen && lastWho.has(part)) start(part, lastWho.get(part), at);
        break;
      case 'closed':
        taskOpen = false;
        for (const p of [...holder.keys()]) end(p, at);
        break;
      case 'reopened':
        taskOpen = true;
        for (const [p, who] of lastWho) if (!closedParts.has(p) && !holder.has(p)) holder.set(p, { who, since: at });
        break;
      default:
        break;
    }
  }
  if (Number.isFinite(closedAt)) for (const p of [...holder.keys()]) end(p, closedAt);
  for (const who of Object.keys(out)) out[who] = merge(out[who]);
  return out;
}

function merge(spans) {
  const sorted = spans.filter((s) => s.to > s.from).sort((a, b) => a.from - b.from);
  const out = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.from <= last.to) last.to = Math.max(last.to, s.to);
    else out.push({ ...s });
  }
  return out;
}

/** How many times the task was put back, and how many times a part went to someone who had not held it before. Pure. */
function retriesFrom(events) {
  let reopened = 0;
  let handoffs = 0;
  const held = new Map();
  const give = (part, who) => {
    if (typeof who !== 'string' || !who) return false;
    const s = held.get(part) || new Set();
    const fresh = s.size > 0 && !s.has(who);
    s.add(who);
    held.set(part, s);
    return fresh;
  };
  for (const ev of Array.isArray(events) ? events : []) {
    if (!ev) continue;
    if (ev.kind === 'reopened') reopened += 1;
    else if (ev.kind === 'created') give(1, ev.who);
    else if (ev.kind === 'part-added') give(Number(ev.partId), ev.who);
    else if (ev.kind === 'assigned' && give(ev.partId == null ? 1 : Number(ev.partId), ev.who)) handoffs += 1;
  }
  return { reopened, handoffs };
}

/* The folders Claude Code writes this agent's transcripts under: every config root, the canonical spelling of the
   agent's folder and the recorded one (status.js's #2406 rule, which this reuses rather than re-derives). */
function transcriptDirs(dir) {
  const { configRoots } = require('./status');
  const canon = require('./trust').canonicalOnDisk(dir);
  const flatten = (p) => String(p).replace(/[^A-Za-z0-9]/g, '-');
  const flats = [...new Set([flatten(canon), flatten(dir)])];
  const out = [];
  for (const root of configRoots()) for (const flat of flats) out.push(path.join(root, 'projects', flat));
  return out;
}

/* Every transcript in one project folder: <session>.jsonl and its subagents' at any depth. */
async function transcriptsIn(projectDir) {
  const out = [];
  let entries;
  try { entries = await fsp.readdir(projectDir, { withFileTypes: true }); } catch { return out; }
  const deep = async (d) => {
    let es;
    try { es = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await deep(p);
      else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p);
    }
  };
  for (const e of entries) {
    const p = path.join(projectDir, e.name);
    if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p);
    else if (e.isDirectory()) await deep(path.join(p, 'subagents'));
  }
  return out.sort();
}

/** One agent's Claude work inside its holds. */
async function claudeWork(dir, holds) {
  const inHold = (t) => holds.some((h) => t >= h.from && t <= h.to);
  const first = Math.min(...holds.map((h) => h.from));
  const models = {};
  const files = new Map();     // shown path -> true, in first-seen order
  let commands = 0;
  let sessions = 0;
  let read = 0;
  const seenMsg = new Set();
  const seenTool = new Set();
  const files_ = [];
  for (const d of transcriptDirs(dir)) files_.push(...await transcriptsIn(d));
  for (const file of [...new Set(files_)]) {
    try { if ((await fsp.stat(file)).mtimeMs < first) continue; } catch { continue; }
    let text;
    try { text = await fsp.readFile(file, 'utf8'); } catch { continue; }
    read += 1;
    let counted = false;
    for (const line of text.split('\n')) {
      if (!line || !line.includes('"assistant"') || SYNTHETIC_ROW.test(line)) continue;
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      const t = Date.parse(row && row.timestamp);
      if (!Number.isFinite(t) || !inHold(t)) continue;
      const message = row.message;
      if (!message || typeof message !== 'object') continue;
      counted = true;
      if (message.usage && !(message.id && seenMsg.has(message.id))) {
        if (message.id) seenMsg.add(message.id);
        const m = message.model || 'unknown';
        const b = models[m] || (models[m] = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, rows: 0 });
        for (const f of BUCKET_FIELDS) b[f] += Number(message.usage[f]) || 0;
        b.rows += 1;
      }
      for (const block of Array.isArray(message.content) ? message.content : []) {
        if (!block || block.type !== 'tool_use') continue;
        if (block.id) { if (seenTool.has(block.id)) continue; seenTool.add(block.id); }
        const input = block.input || {};
        if (COMMAND_TOOLS.has(block.name)) commands += 1;
        const key = FILE_TOOLS[block.name];
        if (key && typeof input[key] === 'string' && input[key]) files.set(shownPath(dir, input[key]), true);
      }
    }
    if (counted) sessions += 1;
  }
  const all = [...files.keys()];
  return { models, files: all.slice(0, FILES_SHOWN), filesMore: Math.max(0, all.length - FILES_SHOWN), commands, sessions, transcriptsRead: read };
}

/* A file inside the agent's folder by its path there; anything else in full (it is this person's own computer). */
function shownPath(dir, file) {
  const rel = path.relative(dir, file);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : file;
}

function receiptFile(projectId, number) {
  const chat = taskchat.taskChatFile(projectId, number);
  return chat ? path.join(store.ROOT, DIRNAME, path.basename(chat, '.jsonl') + '.json') : null;
}

/**
 * The receipt for task `number` of project `projectId`, or `{ ready: false, because }` when there is none to give
 * ('no-task', 'open'). `task` is the task as tasks.byNumber returns it. Never throws for a missing transcript.
 */
async function forTask(projectId, task, { now = Date.now() } = {}) {
  if (!task) return { ready: false, because: 'no-task' };
  const closedAt = Date.parse(task.closedAt);
  if (!Number.isFinite(closedAt)) return { ready: false, because: 'open' };
  const keep = receiptFile(projectId, task.number);
  if (keep) {
    try {
      const kept = JSON.parse(fs.readFileSync(keep, 'utf8'));
      if (kept && kept.version === VERSION && kept.closedAt === task.closedAt) return kept;
    } catch { /* none kept yet */ }
  }
  const events = taskchat.read(projectId, task.number);
  const holds = holdsFrom(events, closedAt);
  const create = require('./create');
  const agents = [];
  for (const who of Object.keys(holds).sort()) {
    const spans = holds[who];
    const entry = { who, holds: spans.map((h) => ({ from: new Date(h.from).toISOString(), to: new Date(h.to).toISOString() })) };
    let dir = null;
    try { dir = create.workerDir(who); } catch { dir = null; }
    let runner = null;
    try { runner = create.recordedRunner(who); } catch { runner = null; }
    if (!dir) { agents.push({ ...entry, available: false, because: 'no-folder' }); continue; }
    entry.folder = dir;
    if (runner && runner !== 'claude') { agents.push({ ...entry, provider: runner, available: false, because: 'provider' }); continue; }
    agents.push({ ...entry, provider: 'claude', available: true, ...(await claudeWork(dir, spans)) });
  }
  const receipt = { version: VERSION, closedAt: task.closedAt, retries: retriesFrom(events), agents };
  /* Kept only once the close has settled: a transcript can still be written for a few seconds after it. */
  if (keep && now - closedAt >= SETTLE_MS) {
    try { fs.mkdirSync(path.dirname(keep), { recursive: true }); fs.writeFileSync(keep, JSON.stringify(receipt)); }
    catch { /* worked out again next time */ }
  }
  return receipt;
}

module.exports = { forTask, holdsFrom, retriesFrom, receiptFile, SETTLE_MS, FILES_SHOWN, VERSION };
