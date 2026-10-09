'use strict';
/**
 * kosmos#5683 slice 1 (board half, part 1a): tell the company when its own rules refused an agent's action.
 * The contract is kosmos-relay's `POST /v1/mac/org/agent-events` (plan: kosmos-relay .claude/plans/agentevents-5683.md):
 * Mac-signed, at most 50 events a send, each { world, agent, at, action, rule, targetClass, sessionRef, toolUseRef }.
 *
 * WHICH REFUSALS COUNT. Only rules the company placed (decided on the card, Pete agreed): the token-only guard's deny
 * rules and its sandbox. Only token-only agents (engine/sendertoken.js tokenOnlyList) run under them, so only their
 * transcripts are read. A person's own deny rules, and the auto-mode classifier, are never reported.
 *
 * WHERE A REFUSAL IS SEEN. Claude Code writes a deny-rule refusal into the session transcript as an error tool result,
 * "Permission to use <Tool> with command <cmd> has been denied." (measured, 2.1.295). Its PermissionDenied hook fires
 * only for the auto-mode classifier (measured in the same build), so the transcript is the one place a deny-rule
 * refusal is recorded. A sandbox refusal is a Bash result carrying "Operation not permitted".
 *
 * A REFERENCE, NEVER CONTENT. An event carries the session id and the tool use id (Josh 08:41: the company may open
 * the conversation, through the content view #5686, which logs who looked). The command, the path and the text are
 * never sent: the target is one of a few fixed classes.
 *
 * Part 1a reads this Kosmos's own agents; the other Kosmoses on the same computer (Josh 08:43) are part 1b.
 *
 * scanFile() and classify() are pure; tick() keeps a small state file, gates on the enrollment, and sends.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROUTE = '/v1/mac/org/agent-events';
const SEND_MAX = 50;
const PENDING_MAX = 500;          // kept while sends fail; the oldest go first when it is full
const PAST_MS = 7 * 86400 * 1000; // the coordinator refuses an event older than 7 days
const READ_MAX = 4 * 1024 * 1024; // bytes read from one transcript in one tick; the rest next tick
const STATE_FILE = 'agent-events.json';
const LABEL_MAX = 128;
const AHEAD_S = 300;               // the coordinator refuses an event more than 5 minutes ahead
const SEND_PAST_MS = PAST_MS - 3600 * 1000;   // an hour short of 7 days, so a queued event never expires in flight
/* Tool uses seen but not yet answered, per transcript, kept in memory across ticks (a result can land a tick after its
   call). Lost on a restart: such a result is then classified without its call (tool from the denial text; target
   'other'). Bounded per file. */
const CALLS = new Map();
const CALLS_MAX = 2000;

const DENIED = /^Permission to use ([A-Za-z][A-Za-z0-9_]*)\b[\s\S]* has been denied\.?\s*$/;
const SANDBOX = /\bOperation not permitted\b/;
const ACTION = Object.freeze({
  Bash: 'run', Write: 'write', Edit: 'write', MultiEdit: 'write', NotebookEdit: 'write',
  Read: 'read', Glob: 'read', Grep: 'read', WebFetch: 'network', WebSearch: 'network',
});
const PATH_KEYS = ['file_path', 'notebook_path', 'path'];

/* One label as the coordinator accepts it: 1 to 128 characters, no control or bidi character. Else null (not sent). */
function label(v) {
  if (typeof v !== 'string' || !v) return null;
  const s = [...v].slice(0, LABEL_MAX).join('');
  return /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/.test(s) ? null : s;
}

/* The text of a tool result: a string, or the text blocks of a list. */
function resultText(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
  return '';
}

/* Which class of target a refused call aimed at: never the path itself. */
function targetClass(tool, input, ctx) {
  if (tool === 'WebFetch' || tool === 'WebSearch') return 'network-host';
  let p = null;
  for (const k of PATH_KEYS) if (input && typeof input[k] === 'string' && input[k]) { p = input[k]; break; }
  if (!p && tool === 'Bash' && input && typeof input.command === 'string') {
    const m = input.command.match(/(?:^|[\s'"=])((?:~|\/)[^\s'";|&<>)]*)/);
    if (m) p = m[1];
  }
  if (!p) return 'other';
  const home = ctx.home || os.homedir();
  if (p === '~' || p.startsWith('~/')) p = path.join(home, p.slice(1));
  else if (p.startsWith('~')) return 'other';   // ~user: another account's home, not resolvable here
  /* Resolved (review 1): agentDir/../../<board> is the board's files, the very traversal a company wants to see. */
  p = path.resolve(p);
  const under = (dir) => !!dir && (p === dir || p.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep));
  if (under(ctx.boardRoot)) return 'board-files';
  if (under(ctx.agentDir)) {
    const rest = path.relative(ctx.agentDir, p).split(path.sep);
    return rest[0] === '.claude' ? 'agent-config' : 'other';
  }
  if ((ctx.otherAgentDirs || []).some(under)) return 'other-agent';
  if (under(home)) return 'home';
  return p.startsWith(path.sep) ? 'system' : 'other';
}

/* A refused call's rule, or null when it is not one the company placed. */
function classify(text, tool) {
  if (DENIED.test(text)) return 'token-only-guard';
  if (tool === 'Bash' && SANDBOX.test(text)) return 'sandbox';
  return null;
}

/**
 * Read the complete lines of `text` (a transcript's new bytes) and return the company-rule refusals in it. `calls`
 * carries tool uses across reads (a result can arrive in a later tick than its call). ctx: { agent, session, boardRoot,
 * agentDir, otherAgentDirs, home, now }.
 */
function scanText(text, calls, ctx) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line || (!line.includes('"tool_use"') && !line.includes('"tool_result"'))) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const blocks = row && row.message && Array.isArray(row.message.content) ? row.message.content : [];
    for (const b of blocks) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'tool_use' && typeof b.id === 'string') { calls.set(b.id, { name: b.name, input: b.input || {} }); continue; }
      if (b.type !== 'tool_result' || b.is_error !== true || typeof b.tool_use_id !== 'string') continue;
      const call = calls.get(b.tool_use_id) || {};
      const text0 = resultText(b.content);
      const tool = call.name || ((text0.match(DENIED) || [])[1]) || null;
      const rule = classify(text0, tool);
      if (!rule) continue;
      const at = Date.parse(row.timestamp);
      if (!Number.isFinite(at) || at < ctx.now - PAST_MS) continue;
      const agent = label(ctx.agent);
      const sessionRef = label(ctx.session);
      const toolUseRef = label(b.tool_use_id);
      if (!agent || !sessionRef || !toolUseRef) continue;
      out.push({ agent, at: Math.floor(at / 1000), action: ACTION[tool] || 'run', rule,
        targetClass: targetClass(tool, call.input, ctx), sessionRef, toolUseRef });
      calls.delete(b.tool_use_id);
    }
  }
  return out;
}

/* New complete lines of one transcript since `offset`: { text, next } (next is the offset after the last newline). */
function readFrom(file, offset) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const from = offset > size ? 0 : offset;   // a rewritten file starts again
    const len = Math.min(size - from, READ_MAX);
    if (len <= 0) return { text: '', next: from };
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, from);
    const nl = buf.lastIndexOf(0x0a);
    /* A window with no newline: wait for the line to finish, unless the window is full (a line over READ_MAX, such as
       a large tool result). Then skip past it (review 1): its tail is read next as an unparseable line and ignored,
       and the file never wedges on it. */
    if (nl < 0) return { text: '', next: len === READ_MAX ? from + len : from };
    return { text: buf.subarray(0, nl).toString('utf8'), next: from + nl + 1 };
  } catch { return null; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* closed */ } }
}

/* The session a transcript belongs to: its own name, or, for a subagent's (<session>/subagents/.../agent-x.jsonl), the
   session folder's (review 1: the reference must open a conversation). */
function sessionOf(file) {
  const parts = file.split(path.sep);
  const i = parts.lastIndexOf('subagents');
  return i > 0 ? parts[i - 1] : path.basename(file, '.jsonl');
}

function readState(root) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(root, STATE_FILE), 'utf8'));
    return { offsets: j && typeof j.offsets === 'object' && j.offsets ? j.offsets : {}, pending: Array.isArray(j && j.pending) ? j.pending : [],
      enrolledAs: j && j.enrolledAs, since: j && Number.isFinite(j.since) ? j.since : null };
  } catch { return { offsets: {}, pending: [], enrolledAs: null, since: null }; }
}

function writeState(root, st) {   // whole or not at all; owner-only
  const file = path.join(root, STATE_FILE);
  const tmp = file + '.' + process.pid + '.tmp';
  try { fs.writeFileSync(tmp, JSON.stringify(st), { mode: 0o600 }); fs.renameSync(tmp, file); return true; } catch {
    try { fs.unlinkSync(tmp); } catch { /* none */ }
    return false;
  }
}

function defaultSources() {
  const sendertoken = require('./sendertoken');
  const create = require('./create');
  const receipt = require('./receipt');
  return {
    agents: () => sendertoken.tokenOnlyList(),
    dirOf: (name) => { try { return create.workerDir(name); } catch { return null; } },
    transcripts: async (dir) => {
      const files = [];
      for (const d of receipt._transcriptDirs(dir)) files.push(...await receipt._transcriptsIn(d));
      return [...new Set(files)];
    },
  };
}

/**
 * One tick: read new transcript lines of every token-only agent, queue the company-rule refusals, and send up to
 * SEND_MAX when this is the enrolled Kosmos with the consent recorded here. Never throws.
 * opts: { root, remote, sources, now, home } (tests); the board passes nothing.
 */
async function tick(opts) {
  const o = opts || {};
  try {
    const oe = require('./orgenroll');
    const eo = { root: o.root, remote: o.remote };
    /* THE gate, the rollup's (#5531): the work Kosmos with the consent recorded on this computer, never merely
       enrolled. Not enrolled reads nothing: no transcript is opened for a company that does not exist. */
    if (!oe.mayReport(eo)) return { sent: 0, because: 'not the enrolled Kosmos, or no accepted words recorded here' };
    const rec = oe.readEnrollment(eo);
    if (!rec || typeof rec.world !== 'string') return { sent: 0, because: 'not the enrolled Kosmos' };
    const root = o.root || require('./store').ROOT;
    const now = o.now || Date.now();
    const src = o.sources || defaultSources();
    const joinedAt = Date.parse(rec.enrolledAt);
    /* Fail closed (review 1): with no readable enrollment time, nothing can be shown to be from after it. */
    if (!Number.isFinite(joinedAt)) return { sent: 0, because: 'this enrollment records no time it began' };
    /* The state belongs to one enrollment AND one set of accepted words (review 1): a new enrollment, or words accepted
       again after the company changed them, starts clean, and nothing from before that moment is sent (not the last
       company's queue, not what happened while no words were accepted). */
    const enrolledAs = rec.world + '|' + ((rec.org && rec.org.id) || '') + '|' + (rec.enrolledAt || '') + '|' + (rec.consentHash || '');
    let st = readState(root);
    if (st.enrolledAs !== enrolledAs) {
      const sameEnrollment = typeof st.enrolledAs === 'string' && st.enrolledAs.split('|').slice(0, 3).join('|') === enrolledAs.split('|').slice(0, 3).join('|');
      st = { offsets: {}, pending: [], enrolledAs, since: sameEnrollment ? now : joinedAt };
    }
    const sinceS = Math.floor(Math.max(joinedAt, st.since || joinedAt) / 1000);   // whole seconds, as e.at
    const names = src.agents();
    const dirs = new Map(names.map((n) => [n, src.dirOf(n)]));
    const allDirs = [...dirs.values()].filter(Boolean);
    const seen = new Set();
    for (const [agent, dir] of dirs) {
      if (!dir) continue;
      for (const file of await src.transcripts(dir)) {
        seen.add(file);
        /* Every transcript is read from its start the first time (nothing before `since` is kept), so a refusal between
           the enrollment and the first tick is not lost (review 1). */
        const r = readFrom(file, Object.prototype.hasOwnProperty.call(st.offsets, file) ? st.offsets[file] : 0);
        if (!r) continue;
        st.offsets[file] = r.next;
        if (!r.text) continue;
        const calls = CALLS.get(file) || new Map();
        const ctx = { agent, session: sessionOf(file), boardRoot: root, agentDir: dir,
          otherAgentDirs: allDirs.filter((d) => d !== dir), home: o.home, now };
        for (const e of scanText(r.text, calls, ctx)) {
          if (e.at < sinceS || e.at > Math.floor(now / 1000) + AHEAD_S) continue;
          st.pending.push(Object.assign({ world: rec.world }, e));
        }
        while (calls.size > CALLS_MAX) calls.delete(calls.keys().next().value);
        CALLS.set(file, calls);
      }
    }
    /* A transcript that is gone keeps no offset (review 1: the state file would grow, and each tick opens every one). */
    for (const f of Object.keys(st.offsets)) if (!seen.has(f)) { delete st.offsets[f]; CALLS.delete(f); }
    if (st.pending.length > PENDING_MAX) st.pending = st.pending.slice(-PENDING_MAX);
    st.pending = st.pending.filter((e) => e.at * 1000 >= now - SEND_PAST_MS);
    if (!writeState(root, st)) return { sent: 0, because: 'this Kosmos cannot record what it has read' };
    if (st.pending.length === 0) return { sent: 0, because: null };
    /* The computer print, as the rollup sends it (review 1): the company refuses a copy of this Mac's key elsewhere. */
    const pf = oe.reportPrint(eo);
    if (pf.send === 'later' || pf.send === 'error') return { sent: 0, because: 'this computer could not be read yet' };
    const batch = st.pending.slice(0, SEND_MAX);
    const remote = o.remote || require('./remote');
    let r;
    try { r = await remote.macRequest('POST', ROUTE, Object.assign({ events: batch }, pf.fields)); } catch (e) { r = { ok: false, because: String((e && e.message) || e) }; }
    if (!r || !r.ok) {
      /* A batch the coordinator REFUSES as malformed or too big (org_agent_events_bad / _too_big, public codes) would be
         refused on every retry and hold back every later event. Drop exactly that batch; anything else (offline, busy,
         consent changed, not enrolled) keeps it for the next tick. */
      if (/\borg_agent_events_(bad|too_big)\b/.test(String((r && r.because) || ''))) {
        const left = readState(root);
        left.pending = left.pending.slice(batch.length);
        writeState(root, left);
        return { sent: 0, dropped: batch.length, because: 'the company refused these events as unreadable' };
      }
      /* The company's words changed (409 org_consent_changed): stop, as the rollup does, until they are accepted here. */
      const why = String((r && r.because) || '');
      if (/\borg_consent_changed\b/.test(why)) {
        try { await oe.consentWithdrawn(eo, rec.consentHash); } catch { /* the next tick asks again */ }
        return { sent: 0, because: 'the company\'s words changed; nothing more is sent until they are accepted here' };
      }
      if (/\borg_not_enrolled\b|\borg_not_member\b/.test(why)) {
        try { await oe.refresh(eo); } catch { /* the daily refresh tries again */ }
      }
      return { sent: 0, because: why || 'the send failed' };
    }
    /* Sent: drop exactly what went. A repeat would be ignored by the coordinator (one row per session and tool use). */
    const after = readState(root);
    after.pending = after.pending.slice(batch.length);
    writeState(root, after);
    return { sent: batch.length, because: null };
  } catch (e) {
    return { sent: 0, because: String((e && e.message) || e) };
  }
}

module.exports = { ROUTE, SEND_MAX, scanText, classify, targetClass, label, readFrom, sessionOf, tick };
