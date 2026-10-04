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
const readline = require('node:readline');
const store = require('./store');
const taskchat = require('./taskchat');

const DIRNAME = 'task-receipts';
const SETTLE_MS = 5 * 60 * 1000;
const FILES_SHOWN = 40;
const BUCKET_FIELDS = ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'];
const SYNTHETIC_ROW = /"model":"<[^"]*>"/;
const FILE_TOOLS = { Edit: 'file_path', Write: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' };
const COMMAND_TOOLS = new Set(['Bash']);
/* Bumped when the receipt's shape or counting changes, so a kept receipt from an older build is worked out again.
   2: Codex and Gemini CLI agents are read (slice 2). */
const VERSION = 2;
/* Slice 2: the providers read besides Claude, by the agent's recorded runner. */
const OTHER_PROVIDERS = new Set(['codex', 'gemini']);

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
        /* A part added while the task is closed is held from the put-back, not from now (review 1). */
        if (!ev.who) lastWho.delete(part);
        else if (taskOpen) start(part, ev.who, at);
        else lastWho.set(part, ev.who);
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
    else if (ev.kind === 'part-added') give(ev.partId == null ? 1 : Number(ev.partId), ev.who);
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

/** One agent's Claude work inside its holds. Streams each transcript a line at a time (review 1: a long session can be
    hundreds of MB, more than one string can hold, and reading it whole held the board up), so the board keeps answering.
    `complete` is false when a transcript could not be read through: such a receipt is shown but never kept. */
async function claudeWork(dir, holds) {
  const inHold = (t) => holds.some((h) => t >= h.from && t <= h.to);
  const first = Math.min(...holds.map((h) => h.from));
  const models = {};
  const edits = new Map();     // tool_use id -> shown path, for file-editing calls inside a hold
  const failed = new Set();    // tool_use ids whose result was an error
  const answered = new Set();  // tool_use ids with any result
  let commands = 0;
  let withWork = 0;
  let read = 0;
  let complete = true;
  const seenMsg = new Set();
  const seenTool = new Set();
  const found = [];
  for (const d of transcriptDirs(dir)) found.push(...await transcriptsIn(d));
  for (const file of [...new Set(found)]) {
    let st;
    try { st = await fsp.stat(file); } catch { continue; }
    if (st.mtimeMs < first) continue;                                   // last written before the first hold
    read += 1;
    let counted = false;
    try {
      const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
      for await (const line of rl) {
        if (!line || SYNTHETIC_ROW.test(line)) continue;
        const isAssistant = line.includes('"assistant"');
        const isResult = line.includes('"tool_result"');
        if (!isAssistant && !isResult) continue;
        let row;
        try { row = JSON.parse(line); } catch { continue; }
        const message = row && row.message;
        if (!message || typeof message !== 'object') continue;
        const blocks = Array.isArray(message.content) ? message.content : [];
        if (row.type !== 'assistant') {
          /* A tool's result comes back on a user row: an edit counts only if it did not fail (review 1). */
          for (const block of blocks) {
            if (!block || block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue;
            answered.add(block.tool_use_id);
            if (block.is_error) failed.add(block.tool_use_id);
          }
          continue;
        }
        const t = Date.parse(row.timestamp);
        if (!Number.isFinite(t) || !inHold(t)) continue;
        counted = true;
        if (message.usage && !(message.id && seenMsg.has(message.id))) {
          if (message.id) seenMsg.add(message.id);
          const m = message.model || 'unknown';
          const bk = models[m] || (models[m] = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, rows: 0 });
          for (const f of BUCKET_FIELDS) bk[f] += Number(message.usage[f]) || 0;
          bk.rows += 1;
        }
        for (const block of blocks) {
          if (!block || block.type !== 'tool_use') continue;
          if (block.id) { if (seenTool.has(block.id)) continue; seenTool.add(block.id); }
          const input = block.input || {};
          if (COMMAND_TOOLS.has(block.name)) commands += 1;
          const key = FILE_TOOLS[block.name];
          if (key && block.id && typeof input[key] === 'string' && input[key]) edits.set(block.id, shownPath(dir, input[key]));
        }
      }
    } catch {
      complete = false;   // a transcript that could not be read through: show what was read, keep nothing
    }
    if (counted) withWork += 1;
  }
  /* An edit counts when its result came back and was not an error: a refused or failed edit changed nothing. */
  const files = new Map();
  for (const [id, shown] of edits) if (answered.has(id) && !failed.has(id)) files.set(shown, true);
  const all = [...files.keys()];
  return { models, files: all.slice(0, FILES_SHOWN), filesMore: Math.max(0, all.length - FILES_SHOWN), commands, transcriptsWithWork: withWork, transcriptsRead: read, complete };
}

/**
 * #5153 slice 2: one Codex or Gemini CLI agent's work inside its holds. Tokens are counted by engine/usageproviders.js's
 * own readers and rules (a Codex running total counted by its change, forks and resets; a Gemini reply written twice
 * counted once), through an accumulator of the receipt's own that keeps only rows from the agent's folder inside a hold.
 * The tool calls are read in the same pass (the readers' onRow), by these rules, measured on this Mac 2026-10-03:
 *   - Codex runs a script through one `exec` tool (a custom_tool_call); each `tools.exec_command(` in it is a command,
 *     and each `*** Add|Update|Delete File: <path>` of a `tools.apply_patch(` in it is a file edited, counted only when
 *     the call's output begins "Script completed" (the only outcome measured, 62 of 63; the other was an abort).
 *     Older Codex calls (`shell`, `exec_command`, `local_shell_call`) are counted as commands; an older standalone
 *     apply_patch is not counted as an edit, because how it reports success was not measured here.
 *   - Gemini CLI writes each tool call with an id, a time and a status: run_shell_command is a command; write_file and
 *     replace are a file edited when their status is success. A reply written twice is read once per call id, keeping
 *     the latest status.
 */
const CODEX_COMMAND_FUNCS = new Set(['shell', 'exec_command', 'container.exec']);
const GEMINI_EDIT_TOOLS = new Set(['write_file', 'replace']);
const GEMINI_COMMAND_TOOLS = new Set(['run_shell_command']);

async function providerWork(runner, dir, holds) {
  const up = require('./usageproviders');
  const { canonicalOnDisk } = require('./trust');
  const mine = canonicalOnDisk(dir);
  const sameFolderMemo = new Map();
  const sameFolder = (folder) => {
    if (!folder) return false;
    if (!sameFolderMemo.has(folder)) sameFolderMemo.set(folder, folder === dir || folder === mine || canonicalOnDisk(folder) === mine);
    return sameFolderMemo.get(folder);
  };
  const inHold = (t) => Number.isFinite(t) && holds.some((h) => t >= h.from && t <= h.to);
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  const acc = new up.Acc(day(Math.min(...holds.map((h) => h.from))), day(Math.max(...holds.map((h) => h.to))));
  const models = {};
  const withWork = new Set();
  acc.add = (d, model, folder, b, ts) => {
    if (!sameFolder(folder) || !inHold(Date.parse(ts))) return;
    if (!BUCKET_FIELDS.some((f) => b[f] > 0)) return;
    const m = model || 'unknown';
    const into = models[m] || (models[m] = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, rows: 0 });
    for (const f of BUCKET_FIELDS) into[f] += Number(b[f]) || 0;
    into.rows += 1;
  };
  const commandIds = new Set();
  const pendingPatches = new Map();   // Codex call id -> [paths]
  const edits = new Map();            // call id -> [shown paths], once the call is known to have succeeded
  const gemini = new Map();           // Gemini call id -> { edit, path, status }
  let unnamed = 0;
  acc.onRow = (provider, row, file, folder, fork = {}) => {
    if (!sameFolder(folder)) return;
    /* A forked Codex rollout begins with the parent's history replayed into it, its tool calls included, so work done
       in the parent is not counted as this hold's (review 1). When the fork's time is known, a row stamped at or before it
       is the replay; only when it is not known is everything before the file's first total taken as the replay (the
       token count's fallback). Time alone where it can: a turn's calls come BEFORE its total, so the first-total rule
       would drop the first real turn's calls and edits, not just its tokens (review 2). */
    if (provider === 'codex' && fork.forked) {
      if (Number.isFinite(fork.forkAt) ? !(Date.parse(row && row.timestamp) > fork.forkAt) : !fork.totals) return;
    }
    if (inHold(Date.parse(row && row.timestamp))) withWork.add(file);   // any row of the agent's inside a hold
    if (provider === 'codex') {
      const p = (row && row.payload) || {};
      if (p.type === 'custom_tool_call' || p.type === 'function_call' || p.type === 'local_shell_call') {
        if (!inHold(Date.parse(row.timestamp))) return;
        const id = p.call_id || p.id || ('#' + (unnamed += 1));
        if (commandIds.has(id) || pendingPatches.has(id) || edits.has(id)) return;
        if (p.type === 'custom_tool_call' && p.name === 'exec') {
          const src = String(p.input || '');
          for (let i = 0; i < (src.match(/tools\.exec_command\(/g) || []).length; i += 1) commandIds.add(id + ':' + i);
          if (/tools\.apply_patch\(/.test(src)) {
            /* A relative path is the session's own folder's (review 1), so the same file reads the same either way. */
            const paths = [...src.matchAll(/\*\*\* (?:Add|Update|Delete) File: ([^\n\\"]+)/g)].map((x) => x[1].trim()).filter(Boolean)
              .map((f) => path.resolve(folder, f));
            if (paths.length) pendingPatches.set(id, paths);
          }
        } else if (p.type === 'local_shell_call' || (p.type === 'function_call' && CODEX_COMMAND_FUNCS.has(p.name))) {
          commandIds.add(id);
        }
      } else if (p.type === 'custom_tool_call_output' && pendingPatches.has(p.call_id)) {
        const out = Array.isArray(p.output) ? p.output : [];
        const head = String((out[0] && out[0].text) || (typeof p.output === 'string' ? p.output : '')).split('\n')[0];
        if (head.startsWith('Script completed')) edits.set(p.call_id, pendingPatches.get(p.call_id).map((f) => shownPath(dir, f)));
        pendingPatches.delete(p.call_id);
      }
      return;
    }
    if (provider === 'gemini') {
      for (const tc of Array.isArray(row && row.toolCalls) ? row.toolCalls : []) {
        if (!tc || typeof tc !== 'object' || !tc.id) continue;
        if (!inHold(Date.parse(tc.timestamp || row.timestamp))) continue;
        if (GEMINI_COMMAND_TOOLS.has(tc.name)) commandIds.add(tc.id);
        const fp = tc.args && typeof tc.args.file_path === 'string' ? tc.args.file_path : '';
        if (GEMINI_EDIT_TOOLS.has(tc.name) && fp) gemini.set(tc.id, { path: shownPath(dir, fp), ok: tc.status === 'success' });
      }
    }
  };
  const problems = [];
  let homes;
  try { homes = up.defaultHomes(problems); } catch { homes = { codex: [], gemini: [] }; problems.push('homes'); }
  /* One bad session file marks this agent's receipt partial (never kept), as a Claude transcript does; it does not fail
     the receipt for every agent (review 1). */
  try {
    if (runner === 'codex') await up.scanCodex(acc, homes.codex || []);
    else await up.scanGemini(acc, homes.gemini || []);
  } catch { problems.push('scan'); }
  const files = new Map();
  for (const list of edits.values()) for (const f of list) files.set(f, true);
  for (const g of gemini.values()) if (g.ok) files.set(g.path, true);
  const all = [...files.keys()];
  return {
    models, files: all.slice(0, FILES_SHOWN), filesMore: Math.max(0, all.length - FILES_SHOWN),
    commands: commandIds.size, transcriptsWithWork: withWork.size,
    complete: !acc.incomplete && !problems.length,
  };
}

/* A file inside the agent's folder by its path there; anything else in full (it is this person's own computer). */
function shownPath(dir, file) {
  /* Either spelling of the folder (a link and its target, /tmp and /private/tmp): a session records the one it ran in. */
  let canon = dir;
  try { canon = require('./trust').canonicalOnDisk(dir); } catch { /* the recorded spelling only */ }
  for (const base of [...new Set([dir, canon])]) {
    const rel = path.relative(base, file);
    if (rel && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel)) return rel;   // '..cache/x' is inside
  }
  return file;
}

function receiptFile(projectId, number) {
  const chat = taskchat.taskChatFile(projectId, number);
  return chat ? path.join(store.ROOT, DIRNAME, path.basename(chat, '.jsonl') + '.json') : null;
}

/**
 * The receipt for task `number` of project `projectId`, or `{ ready: false, because }` when there is none to give
 * ('no-task', 'open'). `task` is the task as tasks.byNumber returns it. Never throws for a missing transcript.
 */
/* When the task closed, or null while it is open. A task closed by closing its last part has no closedAt of its own
   (tasks.progressOf says so): its close is its newest part's close (review 1). */
function closedAtOf(task) {
  if (!task) return null;
  if (task.closedAt) return task.closedAt;
  const { progressOf } = require('./tasks');
  const pr = progressOf(task);
  if (!pr.closed) return null;
  let best = null;
  for (const part of pr.parts) if (part.closedAt && (!best || Date.parse(part.closedAt) > Date.parse(best))) best = part.closedAt;
  return best;
}

/* A receipt kept by slice 1 (VERSION 1) is still right when no agent on it was a Codex or Gemini agent, which is all
   slice 2 changes; working it out again could only lose work whose transcripts have since been pruned (review 1). */
function keptStillRight(kept) {
  return kept.version === 1 && Array.isArray(kept.agents)
    && !kept.agents.some((a) => a && OTHER_PROVIDERS.has(a.provider));
}

/* One computation per task at a time: a second request while the first is reading shares its answer. */
const inFlight = new Map();

function forTask(projectId, task, opts = {}) {
  let key;
  try { key = String(projectId) + '\0' + (task && task.number) + '\0' + closedAtOf(task); }
  catch (err) { return Promise.reject(err); }   // never a throw past the route's .catch
  if (inFlight.has(key)) return inFlight.get(key);
  const p = work(projectId, task, opts).finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

async function work(projectId, task, { now = Date.now() } = {}) {
  if (!task) return { ready: false, because: 'no-task' };
  const closedIso = closedAtOf(task);
  const closedAt = Date.parse(closedIso);
  if (!Number.isFinite(closedAt)) return { ready: false, because: 'open' };
  const keep = receiptFile(projectId, task.number);
  if (keep) {
    try {
      const kept = JSON.parse(fs.readFileSync(keep, 'utf8'));
      if (kept && kept.closedAt === closedIso && (kept.version === VERSION || keptStillRight(kept))) return kept;
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
    if (runner && OTHER_PROVIDERS.has(runner)) { agents.push({ ...entry, provider: runner, available: true, ...(await providerWork(runner, dir, spans)) }); continue; }
    if (runner && runner !== 'claude') { agents.push({ ...entry, provider: runner, available: false, because: 'provider' }); continue; }
    agents.push({ ...entry, provider: 'claude', available: true, ...(await claudeWork(dir, spans)) });
  }
  const receipt = { version: VERSION, closedAt: closedIso, retries: retriesFrom(events), agents };
  /* Kept only once the close has settled (a transcript can still be written for a few seconds after it), and only when
     every transcript was read through: a partial read is shown, then worked out again next time. */
  if (keep && now - closedAt >= SETTLE_MS && agents.every((a) => a.complete !== false)) {
    try { fs.mkdirSync(path.dirname(keep), { recursive: true }); fs.writeFileSync(keep, JSON.stringify(receipt)); }
    catch { /* worked out again next time */ }
  }
  return receipt;
}

/**
 * #5153 slice 3: an agent's receipts, newest close first: every closed task (on any project) whose activity shows this
 * agent holding a part, with this agent's own part of that task's receipt. At most `limit` tasks are worked out per
 * call (a receipt not yet kept reads transcripts), and `more` says whether older ones exist. Each task's receipt is
 * the same one its task page shows (forTask: shared, kept once settled), so the two never disagree.
 */
async function forAgent(who, { limit = 10, now = Date.now(), receiptOf = forTask } = {}) {   // receiptOf: a test seam
  const lim = Math.max(1, Math.min(50, Number(limit) || 10));
  let all = [];
  try { all = require('./projects').readAll() || []; } catch { return { ok: false, receipts: [], more: false }; }
  const closed = [];
  for (const proj of all) {
    if (!proj || !proj.id) continue;
    for (const task of proj.tasks || []) {
      const iso = closedAtOf(task);
      const at = iso ? Date.parse(iso) : NaN;
      if (Number.isFinite(at)) closed.push({ proj, task, iso, at });   // an unreadable close time cannot be ordered
    }
  }
  closed.sort((x, y) => y.at - x.at || String(x.proj.id).localeCompare(String(y.proj.id)) || x.task.number - y.task.number);
  const picked = [];
  let more = false;
  for (const c of closed) {
    /* Held by this agent? The task's own activity says, before any transcript is read. */
    const holds = holdsFrom(taskchat.read(c.proj.id, c.task.number), c.at);
    if (!holds[who]) continue;
    if (picked.length >= lim) { more = true; break; }
    picked.push(c);
  }
  /* A few at a time, in order (review 1: one after another, ten receipts not yet kept read their transcripts in series
     before anything painted). Each is the shared, kept receipt once it settles. */
  const out = new Array(picked.length);
  const AT_ONCE = 3;
  for (let i = 0; i < picked.length; i += AT_ONCE) {
    await Promise.all(picked.slice(i, i + AT_ONCE).map(async (c, j) => {
      /* One task whose receipt cannot be worked out is a row that says so, never the whole list lost (review 2). */
      let r = null;
      try { r = await receiptOf(c.proj.id, c.task, { now }); } catch (err) { console.error('receipts: task ' + c.task.number + ':', (err && err.message) || err); }
      const mine = (r && Array.isArray(r.agents) ? r.agents : []).find((x) => x && x.who === who) || null;
      out[i + j] = { project: c.proj.id, projectName: c.proj.name || c.proj.id, number: c.task.number, sentence: c.task.sentence || '',
        closedAt: c.iso, retries: (r && r.retries) || null, receipt: mine };
    }));
  }
  return { ok: true, receipts: out, more };
}

module.exports = { forAgent, forTask, holdsFrom, retriesFrom, closedAtOf, receiptFile, providerWork, SETTLE_MS, FILES_SHOWN, VERSION };
