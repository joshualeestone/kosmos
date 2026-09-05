'use strict';

/**
 * The native-win32 Layer 1 report writer (#570 write-half, the node twin of
 * install/kosmos-report-hook.sh).
 *
 * Claude Code hooks hand a script an event on stdin; that script maps the event
 * to one of the six report words so the board reads an agent's state from the
 * agent's own record instead of scraping its pane. On the Mac that script is
 * the 299-line bash hook. Native Windows has no bash in the Kosmos bundle
 * (gate-(b), #570), so THIS node entry is the win32 hook: reporthook.js wires
 * Claude Code to run `"<node.exe>" "<this file>"` there, and this reads the
 * event and does exactly what the bash hook does.
 *
 * 🔑 THE DELIVERY IS A POST TO /api/report, NOT A LOCAL WRITE. The bash hook's
 * effect is `kosmos report <word> --auto ...`, which POSTs to the board's
 * /api/report with the board + agent tokens; the SERVER records the self-report
 * on receipt (engine/selfreport.js). So this is a faithful CLIENT of the same
 * route -- same event->word table, same body shape, same two token headers --
 * not a re-implementation of the record engine.
 *
 * The mapping (verbatim from the bash hook, which verified it against the hooks
 * docs and this fleet's production hooks):
 *   SessionStart      -> started, but ONLY when `source` is `startup` (#1058):
 *                        a compaction or resume must not clear a waiting state.
 *   UserPromptSubmit  -> working  "answering a prompt"
 *   PreToolUse        -> working  "running <tool>"  (throttled heartbeat, 60s)
 *   PermissionRequest -> needs_you "asking permission to use <tool>[: <cmd>]"
 *   Stop              -> idle     "finished responding"
 *   StopFailure       -> blocked  --on "provider api (<kind>)" --owner provider
 *   SessionEnd        -> stopped
 *
 * EVERY event sends auto:true -- the machine wrote this, not the agent. The
 * board's reconcileReport refuses ONLY an automatic idle/working over a standing
 * waiting state (#900/#1949), server-side; the client just sends auto, exactly
 * as the bash hook passes --auto.
 *
 * 🛑 FAIL-SAFE: a reporting bug must never break an agent. Every path resolves
 * to exit 0. Only SessionStart -- the once-per-session event whose stdout is a
 * systemMessage the person sees -- says a failure OUT LOUD; every other event
 * stays silent on failure, because its stdout is not a channel to the person.
 *
 * DEVIATION FROM THE BASH HOOK, STATED: the bash hook BACKGROUNDS each send so
 * the hook returns instantly, guarding against the board bouncing mid-UPDATE
 * (every unthrottled hook would otherwise stall at the 15s curl ceiling). The
 * native-Windows bundle has NO update path (tools/build-kosmos-windows.sh), so
 * that specific stall window does not exist here; rather than carry a detached
 * cross-platform child just to reproduce the backgrounding, this awaits the
 * POST under a short timeout (< the hook entry's own 15s). A local 127.0.0.1
 * board answers in milliseconds; the timeout bounds only the board-down case.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_TIMEOUT_MS = 8000;
const HEARTBEAT_SECONDS = 60;
const DEFAULT_PORT = 16180;

/** Parse the event JSON off stdin. Tolerant: a non-JSON or empty body yields an
 *  empty object, so the caller simply finds no event and exits 0. */
function parseInput(str) {
  try {
    const v = JSON.parse(String(str == null ? '' : str));
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  } catch { return {}; }
}

/** A field the bash hook reads via jq/sed, defended against odd shapes. */
function field(obj, dotted) {
  let cur = obj;
  for (const k of dotted.split('.')) {
    if (!cur || typeof cur !== 'object') return '';
    cur = cur[k];
  }
  return typeof cur === 'string' ? cur : (typeof cur === 'number' ? String(cur) : '');
}

/**
 * Map one event to a report, or null when nothing should be sent (a non-startup
 * SessionStart continuation, a throttled PreToolUse heartbeat, or an unknown
 * event). Pure: the throttle decision is computed by the caller and passed in as
 * `heartbeatDue`, so this is a table, not I/O.
 *
 * Returns { state, auto, on, owner, until, project, text, loud } where `loud`
 * marks SessionStart's started, the only report whose delivery failure is said
 * out loud.
 */
function reportFor(evt, ctx) {
  const c = ctx || {};
  const event = field(evt, 'hook_event_name');
  if (!event) return null;
  const base = { auto: true, on: '', owner: '', until: '', project: '', text: '', loud: false };
  switch (event) {
    case 'SessionStart': {
      // #1058: SessionStart fires on compaction/resume too, and `started` would
      // clear a deliberate blocked/needs_you. Only `startup` is a new run;
      // treat everything else (and, as today, a MISSING source from an older
      // Claude Code) as a continuation that must not overwrite a waiting state.
      const src = field(evt, 'source');
      if (src && src !== 'startup') return null;
      return { ...base, state: 'started', loud: true };
    }
    case 'UserPromptSubmit':
      return { ...base, state: 'working', text: 'answering a prompt' };
    case 'PreToolUse': {
      if (!c.heartbeatDue) return null;
      const tool = field(evt, 'tool_name') || 'a tool';
      return { ...base, state: 'working', text: 'running ' + tool };
    }
    case 'PermissionRequest': {
      const tool = field(evt, 'tool_name') || 'a tool';
      const cmd = field(evt, 'tool_input.command').slice(0, 200);
      return { ...base, state: 'needs_you', text: 'asking permission to use ' + tool + (cmd ? ': ' + cmd : '') };
    }
    case 'Stop':
      return { ...base, state: 'idle', text: 'finished responding' };
    case 'StopFailure': {
      const kind = field(evt, 'matcher') || field(evt, 'error_type') || 'an api error';
      return { ...base, state: 'blocked', on: 'provider api (' + kind + ')', owner: 'provider' };
    }
    case 'SessionEnd':
      return { ...base, state: 'stopped' };
    default:
      return null;
  }
}

/** The /api/report body, matching the CLI's POST exactly. */
function buildBody(report, fromPane) {
  return {
    state: report.state,
    text: report.text || '',
    on: report.on || '',
    owner: report.owner || '',
    until: report.until || '',
    project: report.project || '',
    auto: report.auto === true,
    from_pane: fromPane || '',
  };
}

/** The board port: the installer bakes KOSMOS_PORT into the win32 launcher, so
 *  it is normally set; the uid derivation mirrors install/kosmos for the rare
 *  unset case (win32 uid is -1, which is neither 0 nor a real account, so it
 *  falls to the plain default rather than a negative modulus). */
function resolvePort(env, uid) {
  const raw = env && env.KOSMOS_PORT;
  if (raw != null && /^\d+$/.test(String(raw))) return Number(raw);
  if (typeof uid === 'number' && Number.isInteger(uid) && uid > 0) {
    return DEFAULT_PORT + 1 + (uid % 3999);
  }
  return DEFAULT_PORT;
}

function resolveUrl(env, uid) {
  return 'http://127.0.0.1:' + resolvePort(env, uid);
}

/** The board token, read from <store.ROOT>/board.token; null when absent (a
 *  non-enforcing board), so the header is simply omitted. */
function readBoardToken(root) {
  if (!root || typeof root !== 'string') return null;
  try {
    const t = fs.readFileSync(path.join(root, 'board.token'), 'utf8').trim();
    return t || null;
  } catch { return null; }
}

/** The per-launch agent token, only when it is a bare hex string (#570 step
 *  1.5): a junk value would take the token arm on the board and be refused
 *  there instead of falling through, turning a good report into a failed one. */
function agentToken(env) {
  const t = env && env.KOSMOS_AGENT_TOKEN;
  return (typeof t === 'string' && /^[0-9a-f]+$/.test(t)) ? t : null;
}

/**
 * POST one report to /api/report. Returns a plain verdict, never throws.
 * `fetchImpl` is injectable; production uses global fetch. Bounded by a timeout
 * so a down board cannot hold the hook past the entry's 15s ceiling.
 */
async function deliver(report, io) {
  const o = io || {};
  const url = o.url + '/api/report';
  const headers = { 'content-type': 'application/json' };
  if (o.boardToken) headers['x-kosmos-board-token'] = o.boardToken;
  if (o.agentToken) headers['x-kosmos-agent-token'] = o.agentToken;
  const doFetch = o.fetchImpl || ((typeof fetch === 'function') ? fetch : null);
  if (!doFetch) return { ok: false, error: 'no fetch available' };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), o.timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    const res = await doFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(buildBody(report, o.fromPane)),
      signal: ctl.signal,
    });
    let body = '';
    try { body = await res.text(); } catch { body = ''; }
    const recorded = /"recorded"\s*:\s*true/.test(body);
    return { ok: !!(res && res.ok) && recorded, status: res && res.status, recorded, body };
  } catch (err) {
    return { ok: false, error: (err && err.message) ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/** The throttle key: TMUX_PANE if present (there is none on native Windows),
 *  else the per-launch agent token, else a constant. Sanitized for a filename. */
function throttleKey(env) {
  const raw = (env && (env.TMUX_PANE || env.KOSMOS_AGENT_TOKEN)) || 'nopane';
  return String(raw).replace(/[^A-Za-z0-9_-]/g, '_');
}

/** Heartbeat gate for PreToolUse: at most one working line per HEARTBEAT_SECONDS
 *  per key. A state change resets the mark (see main). now()/dir are injectable. */
function heartbeatDue(io) {
  const dir = io.throttleDir;
  const mark = path.join(dir, throttleKey(io.env));
  try { fs.mkdirSync(dir, { recursive: true }); } catch { return true; }
  try {
    const last = Number(fs.readFileSync(mark, 'utf8')) || 0;
    if (io.now() - last < HEARTBEAT_SECONDS) return false;
  } catch { /* no mark yet */ }
  try { fs.writeFileSync(mark, String(io.now())); } catch { /* best effort */ }
  return true;
}

function resetMark(io) {
  try { fs.rmSync(path.join(io.throttleDir, throttleKey(io.env)), { force: true }); } catch { /* best effort */ }
}
function setMark(io) {
  try { fs.mkdirSync(io.throttleDir, { recursive: true }); fs.writeFileSync(path.join(io.throttleDir, throttleKey(io.env)), String(io.now())); } catch { /* best effort */ }
}

/**
 * Read the event, map it, deliver it. Always resolves to an exit code of 0
 * (fail-safe); SessionStart additionally prints a systemMessage on a delivery
 * failure so the person learns reporting is off. `io` is fully injectable for
 * tests: { input, env, uid, storeRoot, fetchImpl, now, throttleDir, stdout }.
 */
async function main(io) {
  const o = io || {};
  const env = o.env || process.env;
  const stdout = o.stdout || ((s) => process.stdout.write(s));
  const now = o.now || (() => Math.floor(Date.now() / 1000));
  const throttleDir = o.throttleDir || path.join(os.tmpdir(), 'kosmos-report-throttle');
  const ctx = { env, now, throttleDir };

  const evt = parseInput(o.input);
  const event = field(evt, 'hook_event_name');
  if (!event) return 0;

  // Throttle bookkeeping mirrors the bash hook: PreToolUse consults the mark;
  // every state-change event clears it; UserPromptSubmit sets it (a prompt is a
  // fresh "working", so the next PreToolUse heartbeat waits a full window).
  let due = false;
  if (event === 'PreToolUse') {
    due = heartbeatDue(ctx);
  } else if (event === 'UserPromptSubmit') {
    setMark(ctx);
  } else if (event === 'PermissionRequest' || event === 'Stop' || event === 'StopFailure' || event === 'SessionEnd' || event === 'SessionStart') {
    resetMark(ctx);
  }

  const report = reportFor(evt, { heartbeatDue: due });
  if (!report) return 0;

  const url = o.url || resolveUrl(env, typeof o.uid === 'number' ? o.uid : safeUid());
  let root = o.storeRoot;
  if (root === undefined) { try { root = require('./store').ROOT; } catch { root = null; } }
  const verdict = await deliver(report, {
    url,
    boardToken: readBoardToken(root),
    agentToken: agentToken(env),
    fetchImpl: o.fetchImpl,
    timeoutMs: o.timeoutMs,
    fromPane: env.TMUX_PANE || '',
  });

  if (report.loud && !verdict.ok) {
    // SessionStart: say it once, out loud, the way the bash hook does.
    const reason = verdict.error
      ? ('the board could not be reached (' + verdict.error + ')')
      : (verdict.status ? ('the board answered ' + verdict.status) : 'the report was not recorded');
    stdout(JSON.stringify({
      systemMessage: 'Kosmos reporting is OFF for this session: ' + reason
        + '. The board is falling back to reading the screen.',
    }) + '\n');
  }
  return 0;
}

/** os uid, or -1 where the platform has none (win32). */
function safeUid() {
  try { const u = os.userInfo(); return typeof u.uid === 'number' ? u.uid : -1; }
  catch { return -1; }
}

module.exports = {
  parseInput, field, reportFor, buildBody, resolvePort, resolveUrl,
  readBoardToken, agentToken, deliver, throttleKey, heartbeatDue, main,
  HEARTBEAT_SECONDS, DEFAULT_PORT,
};

/* Run only when invoked directly (Claude Code runs `"<node>" "<this>"`); a
   require() in a test never triggers a network send. stdin is the event JSON. */
if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { input += d; });
  process.stdin.on('end', () => { main({ input }).then((code) => process.exit(code || 0)).catch(() => process.exit(0)); });
  // If stdin never ends (no pipe), do not hang the agent: a short guard exits 0.
  setTimeout(() => { main({ input }).then((code) => process.exit(code || 0)).catch(() => process.exit(0)); }, 10000).unref();
}
