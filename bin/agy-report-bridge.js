#!/usr/bin/env node
'use strict';

/**
 * #4043: the Antigravity (agy) side of self-reporting, the sibling of bin/grok-report-bridge.js and
 * bin/gemini-report-bridge.js. agy runs a hook command from the agent's `.agents/hooks.json` at
 * each lifecycle event, INSIDE the agent's tmux pane (so it inherits TMUX_PANE, the identity
 * /api/report resolves), with the event's payload as JSON on stdin.
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
 *   PostToolUse   -> NOT HOOKED: PreInvocation already follows each tool, and each hook is a node
 *                    start inside agy's loop (hooks run synchronously and block it).
 *   PreToolUse    -> NOT HOOKED at all: in agy it is a PERMISSION GATE (its answer decides
 *                    whether a tool runs), and Kosmos must not take over agy's permission
 *                    decisions to get a status.
 *   needs_you     -> never, from any event (#4006: an idle loop is idle).
 *
 * ⚠️ THIS MUST NEVER BREAK THE AGENT OR SLOW IT MUCH. agy expects JSON on stdout: `{}` (no change)
 * is printed FIRST, before anything else can fail. Every failure is swallowed and the exit code is
 * 0, and the process exits explicitly (an open stdin must not keep it alive). A repeated `working`
 * within THROTTLE_MS on the same pane is not sent at all (no requires, no POST): the same per-pane
 * 60s heartbeat as install/kosmos-report-hook.sh; a change of state always sends. A board that is
 * down costs at most STDIN_TIMEOUT_MS + TIMEOUT_MS on a call that does send.
 */

const TIMEOUT_MS = 1500;
const STDIN_TIMEOUT_MS = 1000;
/* The working heartbeat, per pane: the Claude hook's figure. */
const THROTTLE_MS = 60 * 1000;

const STATE_FOR_EVENT = Object.freeze({
  PreInvocation: 'working',
  Stop: 'idle',
});

/* The per-pane marker: "<state> <epoch ms>" of the last report sent. */
function markerFile(env) {
  const os = require('node:os');
  const path = require('node:path');
  const pane = String((env || process.env).TMUX_PANE || 'nopane').replace(/[^A-Za-z0-9_-]/g, '_');
  return path.join(os.tmpdir(), 'kosmos-agy-throttle', pane);
}

/* Whether this report should be sent: always for a change of state, and for a repeated `working`
   only once THROTTLE_MS has passed. Records what it lets through. Never throws; on any doubt, send. */
function shouldSend(state, nowMs, env) {
  const fs = require('node:fs');
  const path = require('node:path');
  const file = markerFile(env);
  let last = null;
  try {
    const [s, t] = fs.readFileSync(file, 'utf8').trim().split(' ');
    last = { state: s, at: Number(t) };
  } catch { /* no marker yet */ }
  if (last && state === 'working' && last.state === 'working' && Number.isFinite(last.at) && nowMs - last.at < THROTTLE_MS) return false;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, state + ' ' + nowMs);
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

/* The pure event -> report translation, exported for tests. `eventName` is argv[2]; `payload` the
   parsed stdin (may be null: the event name alone is enough). Returns { state, text } or null. */
function reportFor(eventName, payload) {
  const state = STATE_FOR_EVENT[eventName];
  if (!state) return null; // an event we did not hook is ignored, never guessed at
  let text = '';
  if (state === 'idle' && payload && typeof payload === 'object') {
    /* A Stop with an error is still the end of the turn; say so on the card rather than hide it. */
    if (typeof payload.error === 'string' && payload.error.trim()) text = 'The turn ended with an error: ' + payload.error.trim();
  }
  return { state, text };
}

/* The /api/report body. `auto: true` is the field the correctness argument rests on (a turn ending
   must not erase a blocked the agent filed deliberately, #1456); asserted by the test. */
function buildBody(state, text, env) {
  const e = env || process.env;
  return { state, text, on: '', owner: '', until: '', auto: true, from_pane: e.TMUX_PANE || '' };
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

async function main() {
  /* agy reads our stdout as the hook's answer: `{}` means "change nothing". First, always. */
  try { process.stdout.write('{}\n'); } catch { /* nothing to do */ }
  const eventName = process.argv[2] || '';
  if (!STATE_FOR_EVENT[eventName]) return;
  const raw = await readStdin();
  let payload = null;
  try { payload = JSON.parse(raw || ''); } catch { /* the event name alone still reports */ }
  const mapped = reportFor(eventName, payload);
  if (!mapped) return;
  if (!shouldSend(mapped.state, Date.now(), process.env)) return;

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
    method: 'POST', headers, body: JSON.stringify(buildBody(mapped.state, mapped.text, process.env)), signal: controller.signal,
  }).catch(() => { /* a missed report must never become a failed turn */ })
    .finally(() => clearTimeout(timer));
}

if (require.main === module) {
  main().catch(() => { /* never break the agent */ }).finally(() => process.exit(0));
}

module.exports = { STATE_FOR_EVENT, TIMEOUT_MS, STDIN_TIMEOUT_MS, THROTTLE_MS, markerFile, shouldSend, reportFor, buildBody, engineDir };
