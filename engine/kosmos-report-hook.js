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
 * Claude Code to run it in EXEC form (`{ command: <node.exe>, args: [<this
 * file>] }`, no shell involved, #570), and this reads the event on stdin and
 * does exactly what the bash hook does.
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
 *   PermissionRequest -> needs_you "asking permission to use <tool>[: <cmd>]",
 *                        or working "running <tool>" when Kosmos's own allow
 *                        hook answers the request (#5495, no prompt shows)
 *   Stop              -> idle     "finished responding"
 *   StopFailure       -> blocked  --on "provider api (<kind>)" --owner provider
 *   SessionEnd        -> stopped
 *   PostToolUseFailure -> no report: a digest of the failed call to POST /api/toolfail (#6071)
 *
 * EVERY event sends auto:true -- the machine wrote this, not the agent. The
 * board's reconcileReport (#900/#1949/#2456) refuses an automatic idle/working
 * -- and an automatic needs_you -- over a standing DELIBERATE wait, and an
 * automatic idle/working/needs_you over an auto `blocked` (a provider outage),
 * except (#6209) the Stop idle of a turn that ended normally over a provider
 * block of a passing kind (a server error), which clears it unless it had
 * covered a wait on a person or what it covered is unknown (server-side);
 * but it lets an auto idle/working CLEAR a standing auto `needs_you` (this
 * PermissionRequest prompt), so the prompt stops sticking once the turn moves
 * on. The client just sends auto, exactly as the bash hook passes --auto.
 *
 * 🛑 FAIL-SAFE: a reporting bug must never break an agent. Every path resolves
 * to exit 0. Only SessionStart -- the once-per-session event whose stdout is a
 * systemMessage the person sees -- says a failure OUT LOUD; every other event
 * stays silent on failure, because its stdout is not a channel to the person.
 * kosmos#8230: an agent's lost Stop is the exception to "silent": it leaves a
 * line in turn-end-failures.log, as the bash hook's does (see TURN_END_KEEP).
 *
 * DEVIATION FROM THE BASH HOOK, STATED: the bash hook BACKGROUNDS each send so
 * the hook returns instantly, guarding against the board bouncing mid-UPDATE
 * (every unthrottled hook would otherwise stall at the 15s curl ceiling). This
 * hook awaits the POST instead, under a timeout (< the hook entry's own 15s):
 * SessionStart and an agent's Stop get DEFAULT_TIMEOUT_MS; every other report,
 * and the Windows supervisor's noRetry Stop (kosmos#8233), SHORT_TIMEOUT_MS.
 * A local 127.0.0.1 board answers in milliseconds; the timeout bounds only the
 * board-down or busy case. Windows does update in place (engine/win32update.js),
 * so the board-down case includes an update restart:
 * then every report waits out its timeout, and an agent's Stop also waits the
 * kosmos#8230 retry's pause (TURN_END_RETRY_PAUSE_MS) before trying again,
 * within DEFAULT_TIMEOUT_MS in all. That is the price of the Stop not being
 * lost across the restart, which is the loss the retry exists for.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_TIMEOUT_MS = 8000;   // SessionStart: needs its delivery verdict
const SHORT_TIMEOUT_MS = 3000;     // every other event: a fire-report, keep the turn snappy
const TURN_END_RETRY_MIN_MS = 1000;   // kosmos#8230: a retry needs at least this much of the window left
const TURN_END_RETRY_PAUSE_MS = 2000;  // kosmos#8230: as the bash hook's KOSMOS_REPORT_RETRY_S default
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
      // #5495: Kosmos's own allow hook answered this request, so no prompt shows and the agent goes on: say so.
      if (c.kosmosAllows) return { ...base, state: 'working', text: 'running ' + tool };
      const cmd = field(evt, 'tool_input.command').slice(0, 200);
      return { ...base, state: 'needs_you', text: 'asking permission to use ' + tool + (cmd ? ': ' + cmd : '') };
    }
    // kosmos#8230: turnEnd marks the turn's end, as the bash hook's report_turn_end does Stop alone (see main).
    case 'Stop':
      return { ...base, state: 'idle', text: 'finished responding', turnEnd: true };
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

/**
 * #5495: true when this agent runs with Kosmos's own PermissionRequest allow hook (its settings file sets the env names,
 * engine/agentpermission.js) AND this install's decide(), called in-process, allows this request. Any failure reads
 * as false: the report says needs-you, as before #5495.
 */
function kosmosAllows(input, env) {
  try {
    const ap = require('./agentpermission');
    if (!env || !env[ap.ENV_NODE] || !env[ap.ENV_SCRIPT]) return false;   // presence only: the values are not used here
    return Boolean(require('./kosmos-permission-allow').decide(input));
  } catch { return false; }
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

/** The board port: KOSMOS_PORT when the environment carries one (the Mac's plist
 *  and pane do), returned directly. The uid fallback replicates
 *  install/kosmos EXACTLY (measured against its `id -u` branch), so a reuse
 *  off-win32 stays in step with the CLI: uid 501 (the primary account) -> the
 *  primary port, every other real uid -> a per-uid offset. A platform with no
 *  uid (win32 is -1) has no account to derive from and takes the primary port.
 *  On win32 nothing sets KOSMOS_PORT today (the launcher reads only PORT), so
 *  this primary-port fallback IS the path every Windows agent takes, and the
 *  board serves that port.
 *  NOTE a deliberate divergence: the CLI uses ${KOSMOS_PORT:-...} verbatim with
 *  NO format check, whereas this requires a bare integer and otherwise falls to
 *  the derivation -- a malformed port would build an unusable URL, and on win32
 *  (single user) the derived fallback is the primary port, so failing to it is
 *  safer than posting to http://127.0.0.1:<garbage>. */
function resolvePort(env, uid) {
  const raw = env && env.KOSMOS_PORT;
  if (raw != null && /^\d+$/.test(String(raw))) return Number(raw);
  if (typeof uid === 'number' && Number.isInteger(uid) && uid >= 0) {
    return uid === 501 ? DEFAULT_PORT : (DEFAULT_PORT + 1 + (uid % 3999));
  }
  return DEFAULT_PORT;
}

function resolveUrl(env, uid) {
  return 'http://127.0.0.1:' + resolvePort(env, uid);
}

/** The board token comes from engine/boardauth.readToken() -- the ONE source of
 *  truth for the token path (boardauth.tokenPath = store.ROOT/board.token), the
 *  same reader the sibling client bin/codex-report-bridge.js uses. This module
 *  does NOT re-derive the path: a second copy of that formula would drift the
 *  day boardauth relocates the token (e.g. the #2040 win32-ACL work) and a
 *  win32 enforcing board would silently refuse this hook's reports. null (a
 *  non-enforcing board) omits the header. */
function readBoardToken() {
  try { return require('./boardauth').readToken(); } catch { return null; }
}

/* #5812 / #5153 on Windows: the four tools that edit a file, as the bash hook's PreToolUse case lists them. */
const KEEP_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const KEEP_TIMEOUT_MS = 3000;   // the bash CLI's `-m 3`: the copy must exist before the edit, but never hold it

/** The keep-copy request for a PreToolUse that is about to edit a file, or null. A path or folder holding a control
 *  character is not sent at all, as `kosmos keep-copy` refuses it: rewriting it would name a different, real file.
 *  On Windows a UNC or device path (\\server\share, \\?\, \\.\pipe) is not sent either: the board resolves the
 *  path synchronously to record the writer, and a share that is slow or gone would stall the board for an SMB
 *  timeout (and reach out to that server). A session folder on one is refused too, since a relative file resolves
 *  under it. A project folder is never on one. */
function keepRequestFor(evt, platform) {
  if (field(evt, 'hook_event_name') !== 'PreToolUse' || !KEEP_TOOLS.has(field(evt, 'tool_name'))) return null;
  const file = field(evt, 'tool_input.file_path') || field(evt, 'tool_input.notebook_path');
  const cwd = field(evt, 'cwd');
  if (!file || /[\u0000-\u001f\u007f]/.test(file + cwd)) return null;
  if ((platform || process.platform) === 'win32' && (/^[\\/]{2}/.test(file) || /^[\\/]{2}/.test(cwd))) return null;   // the folder too: a relative file under it resolves there
  return { path: file, cwd, session: field(evt, 'session_id') };
}

/**
 * POST one keep-copy request to /api/undo/keep, the call `kosmos keep-copy` makes on the Mac. The board keeps a copy
 * only while the person's undo switch is on (#5153), and records which agent is about to write a project file (#5812).
 * Same headers as `deliver`. Waits at most KEEP_TIMEOUT_MS and never throws: the edit goes ahead whatever happens.
 */
async function keepCopy(req, io) {
  const o = io || {};
  const headers = { 'content-type': 'application/json' };
  if (o.boardToken) headers['x-kosmos-board-token'] = o.boardToken;
  if (o.agentToken) headers['x-kosmos-agent-token'] = o.agentToken;
  const { WORLD_HEADER, worldIdForHeader } = require('./launchidentity');
  headers[WORLD_HEADER] = worldIdForHeader(o.world);
  const doFetch = o.fetchImpl || ((typeof fetch === 'function') ? fetch : null);
  if (!doFetch) return { ok: false, error: 'no fetch available' };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), o.timeoutMs || KEEP_TIMEOUT_MS);
  try {
    const res = await doFetch(o.url + '/api/undo/keep', { method: 'POST', headers, body: JSON.stringify(req), signal: ctl.signal, redirect: 'manual' });   // kosmos#6464: never follow, as deliver
    // kosmos#8014: the answer is not needed, so it is cancelled rather than read (a stalled body would wait for the
    // abort): left unread, it held the run open until the 2 s exit backstop, the path that crashed (review 2).
    if (res && res.body && typeof res.body.cancel === 'function') { try { await res.body.cancel(); } catch { /* already done */ } }
    return { ok: !!(res && res.ok), status: res && res.status };
  } catch (err) {
    return { ok: false, error: (err && err.message) ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/* #6071 (slice D1): a value with its object keys sorted at every level, so the same input always hashes the same. */
function sortedKeys(v) {
  if (Array.isArray(v)) return v.map(sortedKeys);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortedKeys(v[k]);
    return out;
  }
  return v;
}

/** #6071 (slice D1): the digest of a failed tool call (PostToolUseFailure) that the board counts, or null. The
 *  signature hashes the tool, its input and the WHOLE error, here, so the input never leaves the computer; only the
 *  error's first line is sent, to be shown. An interrupt is the person stopping the call, not a failure, so it gives
 *  null. The bash hook does the same job, but its signatures are not interchangeable with these (jq's sorted JSON
 *  there, JSON.stringify here): the board only ever compares one agent's signatures with its own. */
function failureRequestFor(evt) {
  if (field(evt, 'hook_event_name') !== 'PostToolUseFailure' || !evt || evt.is_interrupt === true) return null;
  const tool = field(evt, 'tool_name') || 'a tool';
  const whole = String(evt.error == null ? '' : (typeof evt.error === 'string' ? evt.error : JSON.stringify(evt.error)));
  const sig = crypto.createHash('sha256').update(JSON.stringify([tool, sortedKeys(evt.tool_input === undefined ? null : evt.tool_input), whole])).digest('hex');
  return { tool, sig, error: whole.split('\n')[0].slice(0, 300) };
}

/** POST one failure digest to /api/toolfail, the call `kosmos tool-failed` makes on the Mac. Same headers and bound
 *  as keepCopy; never throws, and never holds the agent longer than KEEP_TIMEOUT_MS. */
async function toolFailed(req, io) {
  const o = io || {};
  const headers = { 'content-type': 'application/json' };
  if (o.boardToken) headers['x-kosmos-board-token'] = o.boardToken;
  if (o.agentToken) headers['x-kosmos-agent-token'] = o.agentToken;
  const { WORLD_HEADER, worldIdForHeader } = require('./launchidentity');
  headers[WORLD_HEADER] = worldIdForHeader(o.world);
  const doFetch = o.fetchImpl || ((typeof fetch === 'function') ? fetch : null);
  if (!doFetch) return { ok: false, error: 'no fetch available' };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), o.timeoutMs || KEEP_TIMEOUT_MS);
  try {
    const res = await doFetch(o.url + '/api/toolfail', { method: 'POST', headers, body: JSON.stringify(req), signal: ctl.signal, redirect: 'manual' });   // kosmos#6464: never follow, as deliver
    // kosmos#8014: the answer is not needed, so it is cancelled rather than read (a stalled body would wait for the
    // abort): left unread, it held the run open until the 2 s exit backstop, the path that crashed (review 2).
    if (res && res.body && typeof res.body.cancel === 'function') { try { await res.body.cancel(); } catch { /* already done */ } }
    return { ok: !!(res && res.ok), status: res && res.status };
  } catch (err) {
    return { ok: false, error: (err && err.message) ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/** The POST timeout, per event: the loud SessionStart send needs its verdict, so
 *  it gets the full window; every other event is a fire-report whose loss is
 *  harmless (the next event re-reports), so it uses a short window to bound the
 *  latency it can add to the person's own turn if the board accepts-but-hangs. */
function timeoutFor(report) {
  // kosmos#8230: main widens this to DEFAULT_TIMEOUT_MS for an agent's Stop (see turnEnd there).
  return (report && report.loud) ? DEFAULT_TIMEOUT_MS : SHORT_TIMEOUT_MS;
}

/* kosmos#8230: the Windows twin of install/kosmos-report-hook.sh's report_turn_end (kosmos#7977): an agent's Stop
   gets the full window (DEFAULT_TIMEOUT_MS, so its proof gets half), and the same outcomes:
   - a keep the board meant (its record kept a standing wait, `skipped`), a report it cannot tie to an agent, or
     another account's report: no retry, no note (TURN_END_KEEP);
   - no board at the address (it is not running, or is mid-restart): retried, not noted;
   - a board that did not answer in time, at the proof or at the send (too busy): noted at once, not retried, so a
     stall gets no second send from every agent;
   - anything else: retried once after a pause, and noted when the second try is lost too. Unlike the bash hook,
     which always has time for its retry, a loss that leaves under TURN_END_RETRY_MIN_MS of the window is noted
     without one;
   - a board that proves itself but serves another Kosmos (421 wrongWorld): neither, as the hook is already silent on
     that answer (#1704). Something at the port that cannot prove itself is a loss like any other;
   - a 2xx answer cut off after its headers (our own timeout while the body arrived): not resent, as the board did
     answer, and noted as unconfirmed (kosmos#8233). With the body cut off, a keep cannot be told apart, so one is
     noted too: the visible direction. A cut-off answer of any other status is a refusal, a loss like any other.
   The note goes in the bash hook's file (turn-end-failures.log in the throttle folder), capped the same way; its line
   names the agent's throttle key and the reason, where the bash line names the pane and the CLI's exit code.
   Only an agent's own session (it carries an agent token) gets any of this: the person's own Claude sessions run
   this hook too, and as on the Mac they keep the single short send. A caller that does not wait for this hook (the
   Windows supervisor's in-process idle, engine/win32codexsup.js) passes noRetry: a late retry there could land
   after the next turn's working. Its Stop keeps SHORT_TIMEOUT_MS and is never retried, but a lost, busy or cut-off
   one is still noted at once; no board at the address is not noted, as for any Stop (kosmos#8233).
   Unlike the bash hook, which detaches its send and retry, this hook awaits them (see the header's DEVIATION), so a
   lost agent Stop holds the turn's end for up to DEFAULT_TIMEOUT_MS, against SHORT_TIMEOUT_MS before. That is also
   why the bash hook's STOP_TOKEN (a newer event cancels a pending retry) has no twin here: no later hook event of
   this session starts while this one is still running.
   Two hooks noting at once can lose a line when one trims the file, as two bash hooks can. */
const TURN_END_LOG = 'turn-end-failures.log';
const TURN_END_LOG_MAX_LINES = 400;
const TURN_END_LOG_KEEP_LINES = 200;
const TURN_END_KEEP = /did not overwrite|could not match that to one of your agents|cannot tell which agent|could not tell which agent that was|does not look like something we can identify you by|from the account that started it; run/;

/** What a turn-end verdict means for a retry and a note: 'ok', 'keep', 'quiet', 'busy', 'cut' or 'lost'. */
function turnEndOutcome(v) {
  if (!v || v.ok || v.wrongWorld) return 'ok';
  if (v.skipped || TURN_END_KEEP.test(String(v.because || ''))) return 'keep';
  if (v.notProven) {
    // boardproof counts 'timed out' as nothing there too, so it is read first, as proofRefusalReason reads it.
    if (v.proofWhy === 'timed out') return 'busy';
    return v.nothingThere ? 'quiet' : 'lost';
  }
  if (v.timedOut) return 'busy';   // the send itself ran out of time: the bash hook's "too busy to answer"
  if (v.cutOff) return 'cut';      // kosmos#8233: answered, but the answer was cut off: not resent, noted as unknown
  return 'lost';
}

/** The reason a verdict carries, in the hook's own words, for the note. */
function turnEndReason(v) {
  if (v.notProven) return v.notProven;
  if (v.timedOut) return 'the board did not answer the report in time';
  if (v.cutOff) return v.error;
  if (v.error) return 'the board could not be reached (' + v.error + ')';
  if (v.because) return 'the board did not record it (' + v.because + ')';
  return v.status ? 'the board answered ' + v.status + ' and did not record it' : 'the report was not recorded';
}

function noteTurnEnd(ctx, key, report, verdict, how) {
  const file = path.join(ctx.throttleDir, TURN_END_LOG);
  const line = (new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') + ' agent ' + key + ': ' + report.state
    + (verdict && verdict.cutOff ? ' unconfirmed' : ' not delivered') + how + ': ' + turnEndReason(verdict)).replace(/[\r\n]+/g, ' ').slice(0, 400);
  try {
    fs.mkdirSync(ctx.throttleDir, { recursive: true });
    fs.appendFileSync(file, line + '\n');
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    if (lines.length > TURN_END_LOG_MAX_LINES) fs.writeFileSync(file, lines.slice(-TURN_END_LOG_KEEP_LINES).join('\n') + '\n');
  } catch { /* a note never fails the turn */ }
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
  /* #1704 PR2: name this agent's Kosmos, so a board serving ANOTHER one answers
     421 (wrongWorld) rather than refusing the report as a stranger's. `main`
     passes the process's own world; a caller that passes none is the default. */
  const { WORLD_HEADER, worldIdForHeader } = require('./launchidentity');
  headers[WORLD_HEADER] = worldIdForHeader(o.world);
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
      // kosmos#6464: the board never redirects a report, and fetch would carry the tokens to wherever a listener
      // pointed it, past the proof. 'manual': the 3xx comes back as a failed send, never followed (not 'error', which
      // breaks undici's one retry of the board's 421 on a request with a body).
      redirect: 'manual',
    });
    let body = '';
    try { body = await res.text(); } catch (err) {
      // kosmos#8233: our own timeout after a 2xx head. The board writes its head and body together, once it has
      // decided, so it did answer: whether it recorded is unknown. Not resent (a second idle), and named as such.
      // A cut-off non-2xx answer is a refusal, so it keeps the old path below (an empty body, a loss).
      if (err && err.name === 'AbortError' && res.ok) {
        return { ok: false, status: res.status, cutOff: true, error: 'the board answered ' + res.status + ' but its answer was cut off' };
      }
      body = '';
    }
    const recorded = /"recorded"\s*:\s*true/.test(body);
    // The server's own reason, for the loud SessionStart message (the CLI
    // surfaces this too): a refusal carries "error", a not-recorded carries
    // "because". Either is the actionable sentence; a bare status is not.
    const m = body.match(/"error"\s*:\s*"([^"]*)"/) || body.match(/"because"\s*:\s*"([^"]*)"/);
    /* #1704 PR2: the board is serving ANOTHER Kosmos (421 wrongWorld). Nothing is
       kept for later -- a state this agent was in while its Kosmos was closed is
       stale by the time it opens -- and it is not a failure to tell the person
       about, so `main` stays silent on it. */
    const wrongWorld = Boolean(res) && res.status === 421 && /"wrongWorld"\s*:\s*true/.test(body);
    // kosmos#8230: the board's own skip (a standing wait it kept), told apart from a refusal.
    const skipped = /"skipped"\s*:\s*"[^"]+"/.test(body);
    return { ok: !!(res && res.ok) && recorded, status: res && res.status, recorded, body, because: m ? m[1] : '', wrongWorld, skipped };
  } catch (err) {
    // kosmos#8230: the send ran out of its time (our own abort), told apart from a connection that failed.
    const timedOut = Boolean(err && err.name === 'AbortError');
    return { ok: false, error: (err && err.message) ? err.message : String(err), timedOut };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * #1765: before this hook sends a token, the listener on the board port shows it already holds that token
 * (engine/boardproof.js checkBoard: an HMAC over a fresh nonce, checked here with our own copy). Every account on a
 * Windows computer uses the same port, so whatever answers there is not always this account's board.
 *
 * Returns the check this process uses: (url, token, timeoutMs) resolving { ok, why, nothingThere }. `o.proveBoard`
 * is the test seam (resolving a boolean or { ok, why }). With no seam the real check runs, unless the caller handed in
 * its own `fetchImpl`: that is a test standing in for the board. No production caller passes one (the entry at the
 * bottom of this file, and engine/win32codexsup.js; kosmos-report-hook.board-proof-1765.test.js pins both).
 */
function proverFor(o) {
  const check = (url, token, timeoutMs, prove) => {
    let boardproof;
    try { boardproof = require('./boardproof'); } catch (e) { return Promise.resolve({ ok: false, why: 'the check could not load: ' + ((e && e.message) || e), nothingThere: false }); }
    return boardproof.checkBoard(url, token, { timeoutMs, prove });
  };
  if (typeof o.proveBoard === 'function') return (url, token, timeoutMs) => check(url, token, timeoutMs, o.proveBoard);
  if (o.fetchImpl) return async () => ({ ok: true, why: '', nothingThere: false });
  return (url, token, timeoutMs) => check(url, token, timeoutMs);
}

/** #1765: the words for a check that came out false. Nothing listening (the board is down) and a listener that
 *  cannot prove itself are different situations for the person, so they read differently. */
function proofRefusalReason(r) {
  const w = String((r && r.why) || '');
  if (w === 'timed out') return 'the board did not answer in time, so nothing was sent';
  if (/^the check (could not load|failed)/.test(w)) return 'this computer could not check it was reaching your Kosmos (' + w + '), so nothing was sent';
  if (r && r.nothingThere) return 'the board could not be reached (' + w.replace(/^request failed: /, '') + ')';
  return 'what answers at the board\'s address could not show it is your Kosmos, so nothing was sent to it';
}

/** The throttle key, most-specific first: TMUX_PANE if present (there is none on
 *  native Windows), else a HASH of the per-launch agent token (hashed, never
 *  verbatim: the key is a marker FILENAME under %TEMP% and #1970 keeps the
 *  credential off enumerable surfaces), else the PARENT pid.
 *  🛑 The final fallback is `ppid`, NOT a shared constant: on win32 a launch
 *  whose token-mint failed carries no token (engine/win32create), so a shared
 *  'nopane' key would collapse every such agent onto one mark file and let one
 *  agent's PreToolUse throttle another's. The Claude Code session process is the
 *  hook's parent and is stable across a session's hook fires but distinct per
 *  agent, so ppid isolates them. 'nopane' remains only for the truly-unknowable
 *  case (no pane, no token, no ppid). */
function throttleKey(env, ppid) {
  const pane = env && env.TMUX_PANE;
  if (pane) return String(pane).replace(/[^A-Za-z0-9_-]/g, '_');
  const tok = env && env.KOSMOS_AGENT_TOKEN;
  if (tok) return 'a' + crypto.createHash('sha256').update(String(tok)).digest('hex').slice(0, 16);
  if (typeof ppid === 'number' && ppid > 0) return 'p' + ppid;
  return 'nopane';
}

/** Heartbeat gate for PreToolUse: at most one working line per HEARTBEAT_SECONDS
 *  per key. A state change resets the mark (see main). now()/dir are injectable. */
function heartbeatDue(io) {
  const dir = io.throttleDir;
  const mark = path.join(dir, throttleKey(io.env, io.ppid));
  try { fs.mkdirSync(dir, { recursive: true }); } catch { return true; }
  try {
    const last = Number(fs.readFileSync(mark, 'utf8')) || 0;
    if (io.now() - last < HEARTBEAT_SECONDS) return false;
  } catch { /* no mark yet */ }
  try { fs.writeFileSync(mark, String(io.now())); } catch { /* best effort */ }
  return true;
}

/* kosmos#8014 (the win32 twin of #8011, #7989 slice 3): the file-owner notices Kosmos kept for this agent, handed to it
   at UserPromptSubmit as the hook's additionalContext, as install/kosmos-report-hook.sh does with
   `kosmos file-notices --hook --ack-file <mark>-ack`. The call holds up the turn, so an agent asks at most once per
   FILE_NOTICE_EVERY seconds. Keyed by the agent (the first 16 hex of sha256 of its agent token), as on the Mac: there is
   no pane on native Windows, and with no agent token the board could never say who is asking, so no call is made. A
   mark that cannot be written means no call, so a broken throttle never costs every turn. */
const FILE_NOTICE_EVERY = 300;
const FILE_NOTICE_TIMEOUT_MS = 1000;   // the CLI's cap for --hook
function fileNoticeMark(io) {
  const tok = agentToken(io.env);   // the token this hook would send; one it would not send cannot say who asks
  if (!tok) return null;
  return path.join(io.throttleDir, 'agent-' + crypto.createHash('sha256').update(String(tok)).digest('hex').slice(0, 16) + '.filenotices');
}
function fileNoticesDue(io) {
  const mark = fileNoticeMark(io);
  if (!mark) return null;
  try { fs.mkdirSync(io.throttleDir, { recursive: true }); } catch { return null; }
  try {
    const last = Number(String(fs.readFileSync(mark, 'utf8')).trim());
    if (Number.isFinite(last) && io.now() - last < FILE_NOTICE_EVERY) return null;
  } catch { /* no mark yet */ }
  try { fs.writeFileSync(mark, String(io.now()) + '\n'); } catch { return null; }
  return mark;
}
/** POST /api/file-notices/take?as=hook with the ids handed over last time, as `kosmos file-notices --hook --ack-file`
 *  does. Returns the hook JSON to print, or ''. Never throws; every failure is silent (the room note is there meanwhile). */
async function takeFileNotices(ackFile, io) {
  const o = io || {};
  let ack = '';
  try { ack = fs.readFileSync(ackFile, 'utf8').slice(0, 400).split('\n')[0]; } catch { ack = ''; }
  if (/[^0-9a-f,]/.test(ack)) ack = '';
  const headers = {};
  if (o.boardToken) headers['x-kosmos-board-token'] = o.boardToken;
  if (o.agentToken) headers['x-kosmos-agent-token'] = o.agentToken;
  const { WORLD_HEADER, worldIdForHeader } = require('./launchidentity');
  headers[WORLD_HEADER] = worldIdForHeader(o.world);
  const doFetch = o.fetchImpl || ((typeof fetch === 'function') ? fetch : null);
  if (!doFetch) return '';
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), o.timeoutMs || FILE_NOTICE_TIMEOUT_MS);
  try {
    const res = await doFetch(o.url + '/api/file-notices/take?as=hook&from_pane=&ack=' + ack, { method: 'POST', headers, signal: ctl.signal, redirect: 'manual' });
    if (!res) return '';
    /* The body is read on every answer, a refusal too, so the response is finished before the run ends. (It was
       suspected of the exit-127 crash and ruled out: that one is process.exit after two requests, see the entry.) */
    let t = '';
    try { t = String(await res.text()); } catch { return ''; }
    if (res.status !== 200) return '';
    if (!t) { try { fs.writeFileSync(ackFile, ''); } catch { /* sent again next time */ } return ''; }
    const m = /^ack:([0-9a-f,]*)\n(\{"hookSpecificOutput":[\s\S]*)$/.exec(t);
    if (!m) return '';
    try { fs.writeFileSync(ackFile, m[1] + '\n'); } catch { /* handed over again next time */ }
    return m[2];
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

function resetMark(io) {
  try { fs.rmSync(path.join(io.throttleDir, throttleKey(io.env, io.ppid)), { force: true }); } catch { /* best effort */ }
}
function setMark(io) {
  try { fs.mkdirSync(io.throttleDir, { recursive: true }); fs.writeFileSync(path.join(io.throttleDir, throttleKey(io.env, io.ppid)), String(io.now())); } catch { /* best effort */ }
}

/**
 * Read the event, map it, deliver it. Resolves to an exit code of 0 (fail-safe), except 2 for a PreToolUse the
 * kill guard refuses (kosmos#8406); SessionStart additionally prints a systemMessage on a delivery
 * failure so the person learns reporting is off. `io` is fully injectable for
 * tests: { input, env, uid, storeRoot, fetchImpl, now, throttleDir, stdout, stderr }.
 */
async function main(io) {
  const o = io || {};
  const env = o.env || process.env;
  const stdout = o.stdout || ((s) => process.stdout.write(s));
  const now = o.now || (() => Math.floor(Date.now() / 1000));
  const throttleDir = o.throttleDir || path.join(os.tmpdir(), 'kosmos-report-throttle');
  // ppid isolates the throttle per agent-session when there is no pane/token
  // (win32 mint-failure case); injectable for tests.
  const ppid = typeof o.ppid === 'number' ? o.ppid : process.ppid;
  const ctx = { env, now, throttleDir, ppid };

  const evt = parseInput(o.input);
  const event = field(evt, 'hook_event_name');
  if (!event) return 0;

  /* kosmos#8406: the Windows twin of the bash hook's #4671 kill guard, first, before anything is sent. Exit 2 refuses
     the tool call, and Claude Code shows the agent the reason on stderr. A refused Write or Edit gets no keep-copy or
     heartbeat, which is right: the edit does not happen. */
  // A guard error must never take the report or the keep-copy with it: it fails open, and the hook goes on.
  let guard = { block: false };
  try { guard = require('./winkillguard').check(evt, env); } catch { /* fail open */ }
  if (guard.block) {
    (o.stderr || ((s) => process.stderr.write(s)))(guard.message);
    return 2;
  }

  /* Where and as whom this hook speaks to the board, worked out once, the first time it is needed. */
  let conn = null;
  const connection = () => {
    if (conn) return conn;
    const url = o.url || resolveUrl(env, typeof o.uid === 'number' ? o.uid : safeUid());
    // The board token: injectable for tests, else boardauth (the single source).
    // #4491 slice 8: with KOSMOS_AGENT_TOKEN_ONLY exactly '1' and a usable agent token, the report goes with that token
    // alone and the board token is not read (POST /api/report takes the agent's token; the same switch slice 7 gives the two CLIs, on its own branch until it merges).
    const ownToken = agentToken(env);
    const tokenOnly = Boolean(ownToken) && env.KOSMOS_AGENT_TOKEN_ONLY === '1';
    const boardToken = tokenOnly ? null : (o.boardToken !== undefined ? o.boardToken : readBoardToken());
    conn = { url, boardToken, agentToken: ownToken, world: require('./launchidentity').worldHeaderValue(env) };
    return conn;
  };

  /* #1765: every send below carries a token, so each first asks the listener to prove it holds that token. Proved
     before EACH send (kosmos#6464): a proof is about the listener at that moment, and the board can restart, or
     another process take its port, between this run's sends. Each check gets half its send's bound and the send what
     is left, so the check never lengthens a hook. Not proven: nothing is sent, and the hook still exits 0. The token
     proved is the one the board reads first (the board token, else the agent token). */
  const prove = proverFor(o);
  const proven = async (c, boundMs) => {
    const token = c.boardToken || c.agentToken;
    if (!token) return { ok: true, leftMs: boundMs };   // nothing to protect
    const t0 = Date.now();
    const r = await prove(c.url, token, Math.max(1, Math.floor(boundMs / 2)));
    return { ok: r.ok, why: r.why, nothingThere: r.nothingThere, leftMs: boundMs - (Date.now() - t0) };
  };

  /* #5812 / #5153 on Windows: just before Claude edits a file, ask the board to keep a copy and note who is writing,
     as the bash hook does on the Mac. On EVERY edit, before the heartbeat throttle below can return early. */
  const keep = keepRequestFor(evt, o.platform);
  if (keep) {
    const c = connection();
    const p = await proven(c, o.keepTimeoutMs || KEEP_TIMEOUT_MS);
    if (p.ok && p.leftMs > 0) {
      await keepCopy(keep, { url: c.url, boardToken: c.boardToken, agentToken: c.agentToken, world: c.world,
        fetchImpl: o.fetchImpl, timeoutMs: p.leftMs });
    }
  }

  /* #6071: a failed tool call goes to the board as a digest (no report), as the bash hook's PostToolUseFailure does. */
  const failed = failureRequestFor(evt);
  if (failed) {
    const c = connection();
    const p = await proven(c, o.keepTimeoutMs || KEEP_TIMEOUT_MS);
    if (p.ok && p.leftMs > 0) {
      await toolFailed(failed, { url: c.url, boardToken: c.boardToken, agentToken: c.agentToken, world: c.world,
        fetchImpl: o.fetchImpl, timeoutMs: p.leftMs });
    }
    return 0;
  }

  // Throttle bookkeeping mirrors the bash hook: PreToolUse consults the mark;
  // every state-change event clears it; UserPromptSubmit sets it (a prompt is a
  // fresh "working", so the next PreToolUse heartbeat waits a full window).
  // #5495: a request Kosmos's own allow hook answers reports working, so it starts a heartbeat window like a prompt does.
  const allows = event === 'PermissionRequest' && kosmosAllows(o.input, env);
  let due = false;
  if (event === 'PreToolUse') {
    due = heartbeatDue(ctx);
  } else if (event === 'UserPromptSubmit' || allows) {
    setMark(ctx);
  } else if (event === 'PermissionRequest' || event === 'Stop' || event === 'StopFailure' || event === 'SessionEnd' || event === 'SessionStart') {
    resetMark(ctx);
  }

  const report = reportFor(evt, { heartbeatDue: due, kosmosAllows: allows });
  if (!report) return 0;

  const c = connection();
  /* One proof and send within boundMs. #1765: a listener that did not prove itself gets nothing; a board that is down
     reads as before. */
  const sendOnce = async (boundMs) => {
    const p = await proven(c, boundMs);
    if (!p.ok) return { ok: false, notProven: proofRefusalReason(p), proofWhy: p.why, nothingThere: p.nothingThere };
    if (p.leftMs <= 0) return { ok: false, error: 'out of time before the report could be sent' };
    return deliver(report, {
      url: c.url,
      boardToken: c.boardToken,
      agentToken: c.agentToken,
      fetchImpl: o.fetchImpl,
      timeoutMs: p.leftMs,
      fromPane: env.TMUX_PANE || '',
      world: c.world,
    });
  };
  // kosmos#8230: an agent's Stop, from a caller that waits for this hook, follows the bash hook's rules (see TURN_END_KEEP).
  const agentStop = report.turnEnd === true && Boolean(agentToken(env));
  const turnEnd = agentStop && o.noRetry !== true;
  const budget = o.timeoutMs || (turnEnd ? DEFAULT_TIMEOUT_MS : timeoutFor(report));
  const t0 = Date.now();
  let verdict = await sendOnce(budget);

  if (turnEnd) {
    const key = throttleKey(env, ppid);
    let outcome = turnEndOutcome(verdict);
    if (outcome === 'busy') {
      noteTurnEnd(ctx, key, report, verdict, ', the board was too busy (not retried)');
    } else if (outcome === 'cut') {
      noteTurnEnd(ctx, key, report, verdict, ' (not retried)');
    } else if (outcome === 'quiet' || outcome === 'lost') {
      const left = budget - (Date.now() - t0);
      const pause = Math.min(o.retryPauseMs !== undefined ? o.retryPauseMs : TURN_END_RETRY_PAUSE_MS, Math.floor(left / 2));
      if (left - pause >= TURN_END_RETRY_MIN_MS) {
        await (o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms))))(pause);
        verdict = await sendOnce(left - pause);
        outcome = turnEndOutcome(verdict);
        if (outcome === 'lost' || outcome === 'busy' || outcome === 'cut') noteTurnEnd(ctx, key, report, verdict, ' after a retry');
      } else if (outcome === 'lost') {
        noteTurnEnd(ctx, key, report, verdict, ' (no time left to retry)');
      }
    }
  } else if (agentStop) {
    // kosmos#8233: a caller that does not wait (noRetry) gets no retry, but a lost, busy or cut-off Stop is noted.
    const outcome = turnEndOutcome(verdict);
    if (outcome === 'busy') {
      noteTurnEnd(ctx, throttleKey(env, ppid), report, verdict, ', the board was too busy (not retried: its caller does not wait)');
    } else if (outcome === 'lost' || outcome === 'cut') {
      noteTurnEnd(ctx, throttleKey(env, ppid), report, verdict, ' (not retried: its caller does not wait)');
    }
  }

  /* #1704 PR2: a board serving another Kosmos (421) is not reporting being off:
     this agent's own Kosmos is simply not the one open, and a report is not kept
     for later. Silent, like every non-loud event. */
  if (report.loud && !verdict.ok && !verdict.wrongWorld) {
    // SessionStart: say it once, out loud, the way the bash hook does -- and
    // surface the SERVER'S reason when it gave one. A 200-with-recorded:false
    // (e.g. the board is enforcing and the agent token was missing) must NOT
    // read as "the board answered 200", which implies success; the `because`
    // is the actionable sentence, so it wins over the bare status.
    const reason = verdict.notProven
      ? verdict.notProven
      : verdict.cutOff
      ? verdict.error
      : verdict.error
      ? ('the board could not be reached (' + verdict.error + ')')
      : verdict.because
        ? ('the board refused it (' + verdict.because + ')')
        // The server always sends a because/error with a refusal, so these are
        // defensive fallbacks for a malformed or proxied response: a 200 that
        // did not record (never say "answered 200", which implies success), or
        // anything else unrecordable.
        : (verdict.recorded === false || !verdict.status)
          ? 'the report was not recorded'
          : ('the board answered ' + verdict.status);
    // kosmos#8233: a cut-off answer came from a board that answered, so it may well have recorded: unconfirmed, not OFF.
    stdout(JSON.stringify({
      systemMessage: verdict.cutOff
        ? 'Kosmos could not confirm that reporting works for this session: ' + reason + '.'
        : 'Kosmos reporting is OFF for this session: ' + reason + '. The board is falling back to reading the screen.',
    }) + '\n');
  }

  /* kosmos#8014: after the working report, as on the Mac, hand this agent its file-owner notices as this turn's
     context. Claude Code adds a UserPromptSubmit hook's additionalContext to the model and types nothing into the
     session. Only the board's hook JSON is printed, and only when there is a notice. */
  if (event === 'UserPromptSubmit') {
    const fnMark = fileNoticesDue(ctx);
    if (fnMark) {
      const fp = await proven(c, o.fileNoticeTimeoutMs || FILE_NOTICE_TIMEOUT_MS);
      if (fp.ok && fp.leftMs > 0) {
        const json = await takeFileNotices(fnMark + '-ack', { url: c.url, boardToken: c.boardToken, agentToken: c.agentToken,
          world: c.world, fetchImpl: o.fetchImpl, timeoutMs: fp.leftMs });
        if (json) stdout(json.replace(/\n$/, '') + '\n');
      }
    }
  }
  return 0;
}

/** os uid, or -1 where the platform has none (win32). */
function safeUid() {
  try { const u = os.userInfo(); return typeof u.uid === 'number' ? u.uid : -1; }
  catch { return -1; }
}

/**
 * Wire a stdin stream: accumulate `data`, and on END or ERROR call `onDone(input)`
 * exactly once. Extracted + exported so the error path is unit-testable.
 * 🛑 The `error` listener is load-bearing: a stdin stream error (broken pipe /
 * reset) with NO listener is thrown as an uncaught exception in Node and crashes
 * the process non-zero, which would break the agent -- the one outcome the
 * fail-safe contract forbids. Routing error through the same once-only onDone
 * keeps every path resolving to exit 0. Returns { finishNow } so a stdin that
 * never ends can be forced (the backstop timer). */
function attachStdin(stream, onDone) {
  let input = '';
  let done = false;
  const finish = () => { if (done) return; done = true; onDone(input); };
  if (stream.setEncoding) stream.setEncoding('utf8');
  stream.on('data', (d) => { input += d; });
  stream.on('end', finish);
  stream.on('error', finish);
  return { finishNow: finish };
}

module.exports = {
  parseInput, field, reportFor, buildBody, resolvePort, resolveUrl,
  readBoardToken, agentToken, deliver, timeoutFor, throttleKey, heartbeatDue,
  attachStdin, main, kosmosAllows, proverFor, proofRefusalReason, keepRequestFor, keepCopy, KEEP_TIMEOUT_MS, failureRequestFor, toolFailed,
  HEARTBEAT_SECONDS, DEFAULT_PORT, DEFAULT_TIMEOUT_MS, SHORT_TIMEOUT_MS,
  turnEndOutcome, turnEndReason, noteTurnEnd, TURN_END_LOG, TURN_END_KEEP, TURN_END_RETRY_MIN_MS, TURN_END_RETRY_PAUSE_MS,   // kosmos#8230
};

/* Run only when invoked directly (Claude Code spawns node with this file as its
   arg, exec form, #570); a require() in a test never triggers a network send.
   stdin is the event JSON.
   attachStdin fires `run` once (on end OR error), and `done` ends it (kosmos#8014: by letting
   the process finish, process.exit only as a 2 s backstop); the 5 s unref'd timer is the
   backstop for a stdin that never ends -- finishNow shares attachStdin's
   once-guard, so run cannot fire twice regardless of timing. */
if (require.main === module) {
  /* kosmos#8014: the process ends on its own once its work is done, and process.exit is only the backstop. Measured on
     the Windows box (node 24): two requests to the board in one run, then process.exit, died on a libuv assertion
     (UV_HANDLE_CLOSING, exit 127), which a UserPromptSubmit that also takes its file notices did on every prompt. A
     natural exit measured 0 every time. stdin is let go of first (review 1): a stdin that never ended would otherwise
     hold the process until the backstop. The 2 s unref'd timer still ends a run that something else holds open; it
     is the only path that calls process.exit. */
  const done = (code) => {
    process.exitCode = code || 0;
    try { process.stdin.removeAllListeners('data'); process.stdin.pause(); process.stdin.destroy(); } catch { /* already closed */ }
    setTimeout(() => process.exit(code || 0), 2000).unref();
  };
  const run = (input) => main({ input }).then(done).catch(() => done(0));
  const h = attachStdin(process.stdin, run);
  // 5s backstop (not 10s): with the 8s SessionStart deliver (and an agent's Stop, kosmos#8230), 5+8=13s stays under
  // the hook entry's own 15s ceiling even in the pathological never-closing-stdin
  // case (done lets go of stdin, so the run then ends on its own, not 2 s later); Claude Code writes the event and closes stdin in milliseconds, so `run`
  // normally fires at once and only the deliver timeout applies.
  setTimeout(() => h.finishNow(), 5000).unref();
}
