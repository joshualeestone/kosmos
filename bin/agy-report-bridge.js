#!/usr/bin/env node
'use strict';

/**
 * #4043: the Antigravity (agy) side of self-reporting, the sibling of bin/grok-report-bridge.js and
 * bin/gemini-report-bridge.js. agy runs a hook command from the agent's `.agents/hooks.json` at
 * each lifecycle event, with the event's payload as JSON on stdin. It is EXPECTED to run inside the
 * agent's tmux pane and so inherit TMUX_PANE, the identity /api/report resolves; that is not yet
 * measured under the supervisor (release check #1), which is why throttleKey has fallbacks.
 *
 * 📌 MEASURED on Agent1s 2026-09-26 (agy 1.2.x, a real print-mode turn with capture hooks):
 *   PreInvocation -> PostInvocation -> Stop, in that order; every payload carries conversationId,
 *   workspacePaths, transcriptPath and modelName; Stop adds fullyIdle, terminationReason and error.
 * agy's payload does NOT name its own event, so the hook passes the event name as argv[2]
 * (`agy-report-bridge.js Stop`); engine/agyhooks.js writes the hooks that way.
 *
 * The map (report states), and what is deliberately NOT mapped:
 *   PreInvocation -> working   (a model call is starting; it fires before EVERY model call,
 *                               which follows every tool, so it is also the heartbeat)
 *   Stop          -> idle      (the loop ended; fullyIdle false or an error still ends the turn,
 *                               and the agent is alive at its prompt, so idle, never stuck working)
 *   PreToolUse    -> needs_you, ONLY for agy's `ask_question` tool (hooked with that matcher
 *                    alone; the payload's toolCall.name is checked again here): agy is stopped,
 *                    waiting for the person to answer (Gemini-Sub's spec, #4043). Its answer is
 *                    `{"decision":"allow"}`: agy's PreToolUse contract REQUIRES a decision, and
 *                    MEASURED LIVE on agy 1.2.11 (2026-09-27, the served 0.7.01 bytes) both `{}` and
 *                    `{"decision":""}` DENY the tool ("tool call denied by pre-tool hook"), so the
 *                    person was never asked. `allow` is what agy does with no hook at all here: the
 *                    supervisor launches agy with --dangerously-skip-permissions, and the matcher
 *                    lets only ask_question reach this answer. The question is agy's own tool
 *                    schema: args.questions[].question.
 *   PostToolUse   -> working, ONLY for `ask_question`: the person answered, the turn goes on.
 *   Everything else in PreToolUse/PostToolUse is NOT hooked: PreToolUse is agy's permission gate,
 *                    and a hook per tool is a node start inside agy's blocking loop.
 *   needs_you     -> only from a real ask_question; never from an idle loop (#4006).
 *
 * ⚠️ THIS MUST NEVER BREAK THE AGENT OR SLOW IT MUCH. agy expects JSON on stdout: `{}` (no change)
 * is printed FIRST, before anything else can fail. Every failure is swallowed and the exit code is
 * 0, and the process exits explicitly (an open stdin must not keep it alive). A repeated `working`
 * within THROTTLE_MS on the same pane is not sent at all (no requires, no POST): the same per-pane
 * 60s heartbeat as install/kosmos-report-hook.sh; a change of state always sends. The marker is
 * recorded BEFORE the POST: a working lost to a restarting board holds the next heartbeat back for
 * up to 60s, inside the board's ~5 min decay, so it is accepted rather than waiting on the answer.
 * ⚠️ UNMEASURED (release check #5): whether a subagent's or background loop's Stop fires this hook
 * while the parent waits on ask_question. If it does, its auto idle clears the needs_you. A board that is
 * down costs at most STDIN_TIMEOUT_MS + TIMEOUT_MS + the 500ms stdout flush on a call that does send.
 */

const TIMEOUT_MS = 1500;
const STDIN_TIMEOUT_MS = 1000;
/* The working heartbeat, per pane: the Claude hook's figure. */
const THROTTLE_MS = 60 * 1000;

const STATE_FOR_EVENT = Object.freeze({
  PreInvocation: 'working',
  Stop: 'idle',
  PreToolUse: 'needs_you', // ask_question only; see reportFor
  PostToolUse: 'working', // ask_question only
});
/* #4417: NOT an agy hook. The supervisor runs this bridge once with this event right after it starts an agy pane,
   because agy has no session-start hook: its only reports come at a turn's start and end, so an agent restarted and
   not yet spoken to read "Can't tell" until its first message (Josh read that as a broken status, #4414). Kept out of
   STATE_FOR_EVENT on purpose: that map is what agy's hooks fire, and agy never fires this. */
const LAUNCH_EVENT = 'KosmosLaunch';

/* agy's tool that asks the person something and waits (Gemini-Sub's spec, #4043). */
const ASK_TOOL = 'ask_question';

/* What agy reads on stdout. agy's PreToolUse contract REQUIRES a decision: on agy 1.2.11 `{}` and
   `{"decision":""}` were MEASURED to deny the tool (#4043's 0.7.01 regression: an agy agent could not ask its
   person anything). So PreToolUse answers from the payload, never from the event name alone:
     - ask_question: `{"decision":"allow"}`, measured to show the question and wait for the person; the
       supervisor launches agy with --dangerously-skip-permissions, so it is what agy does with no hook;
     - anything else, or a payload that did not arrive or parse: `{"decision":"ask"}`, agy's own permission
       prompt (review 1). The matcher should keep every other tool away, but that is measured for PostToolUse
       only, and the hooks file is read by ANY agy started in that folder (a person's own, run by hand, without
       the flag). An answer keyed on the event name alone would auto-allow every tool there: fail OPEN.
   Every other event answers `{}`, which its contract expects. Pinned against agy's measured contract in
   agyhooks.test.js. */
const ALLOW = '{"decision":"allow"}';
const ASK = '{"decision":"ask"}';
function answerFor(eventName, payload) {
  if (eventName !== 'PreToolUse') return '{}';
  const name = payload && payload.toolCall && payload.toolCall.name;
  return name === ASK_TOOL ? ALLOW : ASK;
}

/* Whose throttle this is: the pane, else the agent's launch token (hashed), else the process that
   ran the hook (agy itself, one per agent), and 'nopane' only when none is known. A shared key
   would let one agent's heartbeat hold another's back (engine/kosmos-report-hook.js throttleKey,
   the same chain). */
function throttleKey(env, ppid) {
  const e = env || process.env;
  /* A pane id (%3) is unique only inside one tmux server, and two Kosmos worlds can run as one user,
     so the pane key carries the world's board port too: world B's %3 never reads world A's marker. */
  if (e.TMUX_PANE) return 'pane-' + String(Number(e.KOSMOS_PORT) || 16180) + '-' + String(e.TMUX_PANE);
  const token = String(e.KOSMOS_AGENT_TOKEN || '').trim();
  if (token) return 'tok-' + require('node:crypto').createHash('sha256').update(token).digest('hex').slice(0, 16);
  const parent = ppid === undefined ? process.ppid : ppid;
  if (parent && parent > 1) return 'ppid-' + parent;
  return 'nopane';
}

/* The per-agent marker: "<state> <epoch ms>" of the last report sent. */
function markerFile(env, ppid) {
  const os = require('node:os');
  const path = require('node:path');
  return path.join(os.tmpdir(), 'kosmos-agy-throttle', throttleKey(env, ppid).replace(/[^A-Za-z0-9_-]/g, '_'));
}

/* Whether this report should be sent: always for a change of state, and for a repeated `working`
   only once THROTTLE_MS has passed. Records what it lets through. Never throws; on any doubt, send. */
function shouldSend(state, nowMs, env, key) {
  const fs = require('node:fs');
  const path = require('node:path');
  const file = markerFile(env);
  let last = null;
  try {
    const raw = fs.readFileSync(file, 'utf8').trim();
    const [s, t] = raw.split(' ');
    // #4569 fix 4: what follows the time (the waiting count), so a new count is not held back as a repeat (older markers have none).
    last = { state: s, at: Number(t), key: raw.split(' ').slice(2).join(' ') };
  } catch { /* no marker yet */ }
  const said = String(key || '').replace(/\s+/g, ' ').trim();
  if (last && state === 'working' && last.state === 'working' && last.key === said && Number.isFinite(last.at) && nowMs - last.at < THROTTLE_MS) return false;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, state + ' ' + nowMs + (said ? ' ' + said : ''));
  } catch { /* a marker we cannot write only costs a duplicate report */ }
  return true;
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      /* Let go of stdin: an agy that left it open would otherwise keep this process alive. */
      try { process.stdin.destroy(); } catch { /* already closed */ }
      resolve(data);
    };
    try {
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => { data += chunk; });
      process.stdin.on('end', finish);
      process.stdin.on('error', finish);
      setTimeout(finish, STDIN_TIMEOUT_MS).unref?.();
    } catch { finish(); }
  });
}

/* #4588: Google's per-account quota, which every agy agent signed in to one account shares. Measured text (a user's
   0.7.07 board, agy on Google AI Ultra):
     API error: RESOURCE_EXHAUSTED (code 429): Individual quota reached. ... Resets in 24m54s.
   quotaResetMs returns the wait in ms when the error is that quota AND names a reset, else null. Hours, minutes and
   seconds are each optional, but at least one must be present. */
function quotaResetMs(error) {
  const e = typeof error === 'string' ? error : '';
  // The account's quota, not any RESOURCE_EXHAUSTED: Google's per-minute limit also says "Quota exceeded for metric
  // ... per minute", so the guard is the measured phrase "quota reached" (reviews 4 and 5).
  if (!/RESOURCE_EXHAUSTED/.test(e) || !/quota reached/i.test(e)) return null;
  // `m(?!s)`: the minutes of "Resets in 5m", never the m of a "500ms" (review 1). Days are read too (review 5): the
  // weekly window may print as "3d4h" (unmeasured; the measured form is "24m54s").
  const m = /Resets in\s*(?:(\d+)\s*d)?\s*(?:(\d+)\s*h)?\s*(?:(\d+)\s*m(?!s))?\s*(?:(\d+)\s*s)?/i.exec(e);
  if (!m || (m[1] === undefined && m[2] === undefined && m[3] === undefined && m[4] === undefined)) return null;
  const ms = ((Number(m[1]) || 0) * 86400 + (Number(m[2]) || 0) * 3600 + (Number(m[3]) || 0) * 60 + (Number(m[4]) || 0)) * 1000;
  return ms > 0 ? ms : null;
}

/* The pure event -> report translation, exported for tests. `eventName` is argv[2]; `payload` the
   parsed stdin (may be null: the event name alone is enough). Returns { state, text } or null; a quota stop (#4588)
   adds `until`, the reset as an ISO time counted from `nowMs`. */
function reportFor(eventName, payload, nowMs) {
  if (eventName === LAUNCH_EVENT) return { state: 'idle', text: '' };   // #4417: up, and no turn has started
  const state = STATE_FOR_EVENT[eventName];
  if (!state) return null; // an event we did not hook is ignored, never guessed at
  if (eventName === 'PreToolUse' || eventName === 'PostToolUse') {
    /* Only ask_question, whatever the matcher let through. A PostToolUse payload carries no tool
       name in agy's docs, so it is trusted to the matcher; a PreToolUse one is checked. */
    const name = payload && payload.toolCall && payload.toolCall.name;
    if (eventName === 'PreToolUse' && name !== ASK_TOOL) return null;
    if (eventName === 'PreToolUse') {
      /* agy's schema (1.2.11 binary): args = { questions: [{ question, options, is_multi_select }] }. */
      const args = (payload.toolCall && payload.toolCall.args) || {};
      const qs = (Array.isArray(args.questions) ? args.questions : [])
        .map((q) => (q && typeof q.question === 'string' ? q.question.trim() : ''))
        .filter(Boolean);
      return { state, text: qs.length ? qs.join(' / ') : 'Antigravity is asking you a question' };
    }
    return { state, text: '' };
  }
  let text = '';
  /* #4569 fix 4: the Muse front (engine/musefront.js) runs this bridge too, and puts its queue in `kosmosWaiting`
     ({ n, yours }) on a working report. agy's own payloads never carry it. The board checks it (selfreport). */
  const w = payload && typeof payload === 'object' ? payload.kosmosWaiting : null;
  if (state === 'working' && w && typeof w === 'object' && Number.isSafeInteger(w.n) && Number.isSafeInteger(w.yours)) {
    return { state, text, waiting: { n: w.n, yours: w.yours } };
  }
  if (state === 'idle' && payload && typeof payload === 'object') {
    /* A Stop with an error is still the end of the turn; say so on the card rather than hide it. */
    if (typeof payload.error === 'string' && payload.error.trim()) text = 'The turn ended with an error: ' + payload.error.trim();
    /* #4588: still idle (the loop has ended, and an automatic blocked would outlive the resume, #2456), but the reset
       travels in `until` so the board can show the pause and resume the agent after it. */
    const wait = quotaResetMs(payload.error);
    if (wait !== null) {
      const now = Number.isFinite(nowMs) ? nowMs : Date.now();
      return {
        state,
        /* Google's own words are kept for whoever reads the record; the board says its own sentence instead
           (status.js quotaPauseUntil's branch), and promises nothing about a resume that may be switched off. */
        // The first sentence is status.js QUOTA_REPORT_PREFIX, which the board keys on: keep them identical.
        text: "Paused: this Google account's shared Antigravity quota ran out. Google said: " + payload.error.trim(),
        until: new Date(now + wait).toISOString(),
      };
    }
  }
  return { state, text };
}

/* The /api/report body. `auto: true` is the field the correctness argument rests on (a turn ending
   must not erase a blocked the agent filed deliberately, #1456); asserted by the test. */
function buildBody(state, text, env, waiting, until) {
  const e = env || process.env;
  const body = { state, text, on: '', owner: '', until: until || '', auto: true, from_pane: e.TMUX_PANE || '' };
  if (waiting) body.waiting = waiting;   // #4569 fix 4
  return body;
}

/* Where the engine is, for the board token and the world header: beside this file in a checkout
   or bundle, else through the engine-path pointer installSupervisor writes (the grok bridge's
   #4012 note). Null when neither resolves; the report then goes without those headers. */
function engineDir(here) {
  const fs = require('node:fs');
  const path = require('node:path');
  const h = here || __dirname;
  const beside = path.join(h, '..', 'engine');
  if (fs.existsSync(path.join(beside, 'boardauth.js'))) return beside;
  try {
    const ptr = String(fs.readFileSync(path.join(h, 'engine-path'), 'utf8')).split(/\r?\n/)[0].trim();
    if (ptr && fs.existsSync(path.join(ptr, 'boardauth.js'))) return ptr;
  } catch { /* no pointer: no engine */ }
  return null;
}

let answered = false;
/* One answer, marked written only once the write did not throw, so the exit-path fallback still answers if the
   real one failed (review 2). */
function answer(text) {
  if (answered) return;
  try { process.stdout.write(text + '\n'); answered = true; } catch { /* the exit path tries again */ }
}
/* Resolves once everything written to stdout has been handed to the pipe: process.exit right after a write does
   not guarantee a pipe is flushed (review 2), and a truncated answer is a deny to agy. Bounded, so a stuck pipe
   cannot hold agy's hook past its timeout. */
function flushed() {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, 500);
    t.unref?.();
    try { process.stdout.write('', () => { clearTimeout(t); resolve(); }); } catch { clearTimeout(t); resolve(); }
  });
}

async function main() {
  /* agy reads our stdout as the hook's answer. Every event but PreToolUse: first, always. PreToolUse's answer
     depends on the tool, so it waits for the payload (readStdin gives up after STDIN_TIMEOUT_MS, inside agy's
     HANDLER_TIMEOUT_S), and if anything fails before it is written, the exit path answers ASK. */
  const eventName = process.argv[2] || '';
  if (eventName !== 'PreToolUse') answer(answerFor(eventName));
  if (!STATE_FOR_EVENT[eventName] && eventName !== LAUNCH_EVENT) return;
  const raw = await readStdin();
  let payload = null;
  try { payload = JSON.parse(raw || ''); } catch { /* the event name alone still reports */ }
  if (eventName === 'PreToolUse') answer(answerFor(eventName, payload));
  const mapped = reportFor(eventName, payload, Date.now());
  if (!mapped) return;
  const waitKey = mapped.waiting ? mapped.waiting.n + '/' + mapped.waiting.yours : '';
  if (!shouldSend(mapped.state, Date.now(), process.env, waitKey)) return;

  const port = Number(process.env.KOSMOS_PORT) || 16180;
  const headers = { 'content-type': 'application/json' };
  const token = String(process.env.KOSMOS_AGENT_TOKEN || '').trim();
  if (/^[0-9a-f]+$/.test(token)) headers['x-kosmos-agent-token'] = token;
  const engine = engineDir();
  try {
    const boardTok = require(require('node:path').join(engine, 'boardauth')).readToken();
    if (typeof boardTok === 'string' && boardTok) headers['x-kosmos-board-token'] = boardTok;
  } catch { /* a missed board token must never become a failed turn */ }
  try {
    const launchidentity = require(require('node:path').join(engine, 'launchidentity'));
    headers[launchidentity.WORLD_HEADER] = launchidentity.worldHeaderValue(process.env);
  } catch { /* a missed world header must never become a failed turn */ }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  await fetch(`http://127.0.0.1:${port}/api/report`, {
    method: 'POST', headers, body: JSON.stringify(buildBody(mapped.state, mapped.text, process.env, mapped.waiting, mapped.until)), signal: controller.signal,
  }).catch(() => { /* a missed report must never become a failed turn */ })
    .finally(() => clearTimeout(timer));
}

if (require.main === module) {
  main().catch(() => { /* never break the agent */ })
    .finally(async () => {
      if ((process.argv[2] || '') === 'PreToolUse') answer(ASK);
      await flushed();
      process.exit(0);
    });
}

module.exports = { STATE_FOR_EVENT, LAUNCH_EVENT, ASK_TOOL, ALLOW, ASK, answerFor, throttleKey, TIMEOUT_MS, STDIN_TIMEOUT_MS, THROTTLE_MS, markerFile, shouldSend, quotaResetMs, reportFor, buildBody, engineDir };
