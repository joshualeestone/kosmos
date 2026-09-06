'use strict';
/**
 * The win32 report-hook ENTRYPOINT: the same Layer 1 writer as
 * install/kosmos-report-hook.sh, with no shell anywhere in the chain.
 *
 * 🛑 WHY THIS EXISTS. Claude Code fires seven events; the Mac answers them with
 * a 299-line bash script that shells to `install/kosmos`, which POSTs with
 * `curl` and parses with `jq`. Measured on a real Windows box (kosmos#2266,
 * plan doc): there is no `bash`, no `sh`, no `jq` and no `node` on PATH there.
 * `reporthook.entryFor` writes the command as `bash "<path>.sh"`, so on Windows
 * the hook does not fail — it never starts, and a fleet with no reports looks
 * exactly like a fleet of idle agents, which is the one outcome #561 forbids.
 *
 * 🔑 THE INTERPRETER IS THE BUNDLE'S OWN, resolved by RELATIONSHIP rather than
 * searched for — the same property the .sh hook's CLI resolution protects, and
 * for the same reason. The Windows bundle ships `runtime\node.exe` at a fixed
 * offset from `app\`, so `reporthook.entryFor` can name it without a PATH lookup
 * and version skew is structurally impossible.
 *
 * 🔑 ONE WRITE PATH, NOT TWO. This POSTs to the board's `/api/report` exactly as
 * the Mac CLI does, presenting `KOSMOS_AGENT_TOKEN` (kosmos#2266) as
 * `x-kosmos-agent-token`. It deliberately does NOT call `selfreport.record`
 * directly, even though it could: the route is where sender resolution, the
 * enforcing-board rules and `denyPaneFallback` live, and a direct write would be
 * a second implementation of "how a report is recorded" — the two-copies defect
 * this codebase pays for most. PigeonPete's decision (#570) left this arm to the
 * box; this is the arm chosen, and the reason.
 *
 * ⚠️ FAIL-SAFE, LIKE ITS SIBLING. A reporting bug must never break an agent, so
 * every path exits 0 and nothing throws out of here.
 */

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/* The six words, the closed list selfreport.STATES holds. Not imported, because
   this file must run standalone from a bundle whose engine/ is present but whose
   store may be elsewhere; the list is asserted against selfreport in the test. */
const STATES = ['started', 'working', 'idle', 'needs_you', 'blocked', 'stopped'];

/* ⚠️ THE PORT, AND THIS IS THE SIXTH COPY OF A LITERAL THE CLI ALREADY CALLS
   "ONE OF FIVE COPIES". It is read from KOSMOS_PORT first, which is what the app
   bundle bakes at install time, so the literal is only the last resort. The
   Mac's uid-derived variant is deliberately NOT reproduced: it exists to keep
   two macOS accounts off one port, and win32 has no getuid — inventing an
   equivalent here would be a platform assumption, not a port. */
function boardPort() {
  const fromEnv = Number(process.env.KOSMOS_PORT);
  return Number.isInteger(fromEnv) && fromEnv > 0 && fromEnv < 65536 ? fromEnv : 16180;
}

/* Only a hex value is presented, the same rule the CLI applies: /api/report
   reads `header || body.token`, so a junk header takes the TOKEN arm and fails
   there rather than falling through. A malformed value is worse than none. */
function agentToken() {
  const t = process.env.KOSMOS_AGENT_TOKEN || '';
  return /^[0-9a-f]+$/.test(t) ? t : '';
}

/* 🛑 THE THROTTLE KEY IS PER-AGENT, AND THE .sh HOOK'S IS NOT. It keys on
   `${TMUX_PANE:-nopane}`, so every PANELESS agent — which on Windows is all of
   them — collapses onto one shared mark and their PreToolUse heartbeats suppress
   each other for 60s (kosmos#2266 recorded this). Claude Code's hook payload
   carries `session_id`, which is exactly the per-agent value the Mac gets from
   its pane id, so the collapse does not survive the port. */
function throttleKey(payload) {
  const id = (payload && (payload.session_id || payload.sessionId))
    || process.env.CLAUDE_CODE_SESSION_ID
    || 'nosession';
  return String(id).replace(/[^A-Za-z0-9_-]/g, '_');
}

function markPath(payload) {
  return path.join(os.tmpdir(), 'kosmos-report-throttle', throttleKey(payload));
}

const HEARTBEAT_SECONDS = 60;

function heartbeatDue(payload) {
  const mark = markPath(payload);
  try { fs.mkdirSync(path.dirname(mark), { recursive: true }); } catch { return true; }
  try {
    const last = Number(fs.readFileSync(mark, 'utf8').trim());
    if (Number.isFinite(last) && (Date.now() / 1000 - last) < HEARTBEAT_SECONDS) return false;
  } catch { /* absent or unreadable is due, same as the shell's `[ -f ]` miss */ }
  return true;
}

function touchMark(payload) {
  try { fs.writeFileSync(markPath(payload), String(Math.floor(Date.now() / 1000))); } catch { /* best effort */ }
}

function clearMark(payload) {
  try { fs.unlinkSync(markPath(payload)); } catch { /* best effort */ }
}

/**
 * POST one report. `done` is called with { ok, because } and never throws.
 *
 * ⚠️ 15s ceiling, matching the CLI's `-m 15`, because a board that is down,
 * refusing, or mid-update-restart must not hold the agent's own prompt.
 */
function postReport(fields, done) {
  const body = JSON.stringify(fields);
  const token = agentToken();
  const req = http.request({
    host: '127.0.0.1',
    port: boardPort(),
    path: '/api/report',
    method: 'POST',
    headers: Object.assign(
      { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      token ? { 'x-kosmos-agent-token': token } : {}
    ),
    timeout: 15000,
  }, (res) => {
    let raw = '';
    res.setEncoding('utf8');
    res.on('data', (c) => { raw += c; });
    res.on('end', () => {
      /* The board answers 200 with {recorded:false, because} for a refusal, so
         the STATUS is not the verdict — the same lesson the Slack poster learned
         the hard way. Read `recorded`. */
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch { /* unreadable body */ }
      if (parsed && parsed.recorded === false) return done({ ok: false, because: parsed.because || 'the board refused the report' });
      if (res.statusCode && res.statusCode >= 400) return done({ ok: false, because: 'the board answered ' + res.statusCode });
      done({ ok: true });
    });
  });
  req.on('timeout', () => { req.destroy(); done({ ok: false, because: 'the board did not answer in time' }); });
  req.on('error', (e) => done({ ok: false, because: 'we could not reach the board (' + ((e && e.code) || 'unknown') + ')' }));
  req.end(body);
}

/* SessionStart is the one event whose stdout carries a systemMessage to the
   person, and the one moment that fires exactly once per session. Every other
   event stays quiet on failure because its stdout belongs to other machinery —
   on PermissionRequest it is the DECISION channel. */
function sayLoudly(sentence) {
  try { process.stdout.write(JSON.stringify({ systemMessage: sentence }) + '\n'); } catch { /* never fatal */ }
}

/**
 * The event -> state table. Byte-for-byte the same mapping as the .sh hook's
 * `case "$EVENT"`, including which events clear the heartbeat mark.
 *
 * EVERY ONE passes auto:true, and that is the point rather than a detail: --auto
 * means THE MACHINE WROTE THIS, not the agent. `selfreport.record` refuses an
 * automatic `idle`/`working` over a standing `blocked`/`needs_you` (#900/#1949),
 * which is what stops this hook erasing a waiting state within seconds of the
 * agent filing it.
 */
function planFor(event, payload) {
  const field = (o, k) => (o && typeof o[k] === 'string' ? o[k] : '');
  const tool = field(payload, 'tool_name') || 'a tool';
  switch (event) {
    case 'SessionStart': {
      /* #1058: SessionStart fires on COMPACTION and RESUME too, and `started`
         clears a deliberate blocked/needs_you. `startup` is an ALLOWLIST of the
         one value observed in a real payload; anything else is treated as a
         continuation, so an unknown future value degrades toward NOT erasing a
         waiting state. No `source` at all is an older Claude Code and still
         reports, exactly as today. */
      const src = field(payload, 'source');
      if (src && src !== 'startup') return { skip: true, clear: true };
      return { clear: true, loud: true, fields: { state: 'started', auto: true } };
    }
    case 'UserPromptSubmit':
      return { touch: true, fields: { state: 'working', auto: true, text: 'answering a prompt' } };
    case 'PreToolUse':
      return { throttled: true, fields: { state: 'working', auto: true, text: 'running ' + tool } };
    case 'PermissionRequest': {
      const cmd = String((payload && payload.tool_input && payload.tool_input.command) || '').slice(0, 200);
      return { clear: true, fields: { state: 'needs_you', auto: true, text: 'asking permission to use ' + tool + (cmd ? ': ' + cmd : '') } };
    }
    case 'Stop':
      return { clear: true, fields: { state: 'idle', auto: true, text: 'finished responding' } };
    case 'StopFailure': {
      const kind = field(payload, 'matcher') || field(payload, 'error_type') || 'an api error';
      return { clear: true, fields: { state: 'blocked', auto: true, on: 'provider api (' + kind + ')', owner: 'provider' } };
    }
    case 'SessionEnd':
      return { clear: true, fields: { state: 'stopped', auto: true } };
    default:
      return { skip: true };
  }
}

function run(input, done) {
  let payload = null;
  try { payload = JSON.parse(input); } catch { /* an unreadable payload is not a reason to break the agent */ }
  const event = (payload && typeof payload.hook_event_name === 'string') ? payload.hook_event_name : '';
  const plan = planFor(event, payload);

  if (plan.clear) clearMark(payload);
  if (plan.touch) touchMark(payload);
  if (plan.skip) return done(0);

  if (plan.throttled) {
    if (!heartbeatDue(payload)) return done(0);
    touchMark(payload);
  }

  if (!STATES.includes(plan.fields.state)) return done(0);   // unreachable; the table is the closed list

  if (!plan.loud) {
    /* Fire and forget: the report either lands or it does not, and SessionStart
       below is the once-per-session place where "does not" is said out loud. */
    postReport(plan.fields, () => done(0));
    return;
  }

  /* The DELIVERY check. A hook that runs and a report that LANDS are different
     claims, and everywhere else this file swallows the difference on purpose.
     Once per session it is checked for real, and the board's own sentence is
     surfaced so the person reads the actual reason. */
  postReport(plan.fields, (r) => {
    if (!r.ok) {
      sayLoudly('Kosmos reporting is OFF for this session: the report could not be recorded. '
        + (r.because || 'The board did not say why.') + ' The board is falling back to reading the screen.');
    }
    done(0);
  });
}

/* istanbul ignore next -- the process wrapper; `run` is what the tests drive. */
if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { input += c; });
  process.stdin.on('error', () => { /* no payload is survivable */ });
  process.stdin.on('end', () => {
    try { run(input, (code) => process.exit(code)); }
    catch { process.exit(0); }   // FAIL-SAFE: never break the agent
  });
}

module.exports = { run, planFor, boardPort, agentToken, throttleKey, heartbeatDue, STATES, HEARTBEAT_SECONDS };
