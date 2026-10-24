#!/usr/bin/env node
'use strict';

/**
 * The codex side of self-reporting (#245, on #526's interface): codex's
 * `notify` hook runs this with one JSON argument per event, and this
 * translates the event into the report vocabulary and posts it to the
 * board's /api/report — the same record `kosmos report` writes, arriving
 * with the same evidence property, because codex runs INSIDE the agent's
 * tmux pane and this child inherits TMUX_PANE, which is the identity the
 * route resolves. Nothing here invents a sender: there is no name to pass.
 *
 * ⚠️ THIS LINE USED TO END "No sender argument exists to forge", which read
 * as unforgeable and is stronger than the code. A PANE ID IS ITSELF A CLAIM:
 * ids are enumerable and the board has no auth, so a local process can pass
 * another agent's pane and be recorded as that agent. True of this bridge
 * and of `kosmos report` alike. The correction has been in the `/api/reply`
 * comment for a while; this was a copy it never reached (#570).
 *
 * 🔑 ONE OBSERVED EVENT, ONE HONEST WORD. codex-cli 0.149.x emits
 * `agent-turn-complete` (measured on this machine, 2026-08-24, with a spy
 * notify: type, thread-id, turn-id, cwd, input-messages,
 * last-assistant-message). A completed turn means the agent is IDLE: done
 * and waiting. `working` stays the pane reader's to corroborate (the
 * spinner and the esc-to-interrupt line, #249), and `needs_you` stays the
 * dialog markers', because under the bypass-sandbox launch no approval
 * event ever fires. Events we have not observed are ignored, not guessed
 * at: add by observing, the same rule as the markers.
 *
 * ⚠️ THIS MUST NEVER BREAK THE AGENT. Every failure is swallowed; the
 * exit code is always 0; the POST has a short timeout. A board that is
 * down costs a report, never a turn.
 */

const TIMEOUT_MS = 5000;

/* #4023 (the codex sibling of #4012): where the engine is, for the board token and the world
   header below. In a checkout and in the bundle this file sits in bin/ with engine/ beside it.
   The copy every codex agent actually RUNS is the one installSupervisor puts in <supportDir>/bin,
   which has no engine/ beside it, so `require('../engine/...')` always failed there and the two
   headers this file promises were never sent. That folder does carry the `engine-path` pointer
   installSupervisor writes (#1139, the same file agent-supervisor.sh reads), so fall back to it.
   Null when neither resolves: the report then goes without those headers, exactly as before.
   The same lookup as bin/gemini-report-bridge.js and bin/grok-report-bridge.js; each bridge is
   copied alone into <supportDir>/bin, so none can require a shared helper to find the engine. */
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

/* The headers every POST to the board carries: the notify report and (#5812) the hook's keep call. */
function headersFor(env) {
  /* #1139 link 3: PRESENT THE LAUNCH TOKEN WHEN WE HAVE ONE.
     The supervisor mints per launch and puts it in the pane environment, and
     until now nothing read it, so every report on this path was identified by
     its pane alone.

     \u26a0\ufe0f SILENCE IS THE SAFE DEFAULT AND IT IS THE COMMON CASE. An agent
     launched before the mint worked has no token here, so no header is sent
     and its identity is derived from the pane exactly as before. That is what
     keeps this from touching agents that are already running.

     \U0001f6d1 AND THE ROUTE DOES NOT DOWNGRADE: a presented token DECIDES, so a
     token that does not resolve is a REFUSAL rather than a fall back to the
     pane. That is correct -- a caller free to pick the weaker check would pick
     it -- but it means a malformed value here turns a working report into a
     silent refusal. Hence the shape test: the same hex rule the supervisor
     applies before exporting, applied again before presenting, because a
     partial write or a stray warning on stdout is exactly what it guards. */
  const headers = { 'content-type': 'application/json' };
  const token = String(env.KOSMOS_AGENT_TOKEN || '').trim();
  if (/^[0-9a-f]+$/.test(token)) headers['x-kosmos-agent-token'] = token;

  /* #1968: ALSO present the board token. The agent-token arm above is empty for
     almost every agent (the common case), and #1946 makes an enforcing board
     refuse a bare-pane report as the cross-account spoof path. The board token
     is the same-account credential a report presents instead; this bridge runs
     INSIDE the agent's pane, same account as the board, so it can read the
     mode-600 token file. Read via boardauth (the ONE source of truth for the
     path -- no formula duplicated here). Guarded to the letter of this file's
     cardinal rule: a token we cannot read must never break the agent, so any
     failure just omits the header and the pane arm carries the report exactly as
     before on a non-enforcing board. */
  const engine = engineDir();
  /* #4491 slice 8: with KOSMOS_AGENT_TOKEN_ONLY exactly '1' and the agent's own token above, the report goes with that
     token alone and the board token is not read (POST /api/report takes the agent's token; the same switch slice 7 gives the two CLIs, on its own branch until it merges). */
  if (!(headers['x-kosmos-agent-token'] && env.KOSMOS_AGENT_TOKEN_ONLY === '1')) try {
    const boardTok = require(require('node:path').join(engine, 'boardauth')).readToken();
    if (typeof boardTok === 'string' && boardTok) headers['x-kosmos-board-token'] = boardTok;
  } catch { /* a missed board token must never become a failed turn */ }

  /* #1704 PR2: name this agent's Kosmos (`default` when KOSMOS_WORLD is absent),
     so a board serving ANOTHER Kosmos answers 421 instead of refusing the report
     as a stranger's. Nothing is kept on a 421: a report is stale by the time its
     Kosmos opens, so it costs one report, exactly as a down board does. Guarded
     by this file's cardinal rule, like the token read above. */
  try {
    const launchidentity = require(require('node:path').join(engine, 'launchidentity'));
    headers[launchidentity.WORLD_HEADER] = launchidentity.worldHeaderValue(env);
  } catch { /* a missed world header must never become a failed turn */ }

  return headers;
}

/* #1765: a token goes only to a listener that proves it already holds it (engine/boardproof.js). Another account can
   listen on this port while the board is down. Proven through the same fetch the send uses. An engine without that
   module (older than this file), or none found at all, or one that fails to load,
   cannot check, and the send goes ahead as before. `timeoutMs` bounds the proof; each
   caller gives it at most half its own bound and sends in what is left, so the proof never adds to that bound. */
async function mayCarry(port, headers, fetchImpl, timeoutMs) {
  let bp;
  try { bp = require(require('node:path').join(engineDir(), 'boardproof')); } catch { return true; }
  return bp.mayCarryTokensTo(`http://127.0.0.1:${port}`, headers, { fetchImpl: fetchImpl || fetch, timeoutMs });
}

function main() {
  let event;
  try { event = JSON.parse(process.argv[2] || ''); } catch { return; }
  if (!event || event.type !== 'agent-turn-complete') return;

  const port = Number(process.env.KOSMOS_PORT) || 16180;
  const body = JSON.stringify({
    state: 'idle',
    // The last words, so the card can say what it finished with. The
    // engine caps this; the words stay on this Mac (selfreport.js's own
    // note), and nothing here leaves the machine.
    text: typeof event['last-assistant-message'] === 'string'
      ? event['last-assistant-message'] : '',
    on: '',
    owner: '',
    until: '',
    /* #1456: THE MACHINE IS WRITING THIS, NOT THE AGENT. `agent-turn-complete`
       is the Codex analogue of Claude's Stop hook: it fires at the end of
       every turn. Without this field the route sends `auto: false`, and #900's
       guard (selfreport.js), which refuses an automatic `idle` (and, since
       #1949, `working`), is never entered -- so a `blocked` the agent filed
       DURING the turn is erased by its own turn ending, seconds later.

       ⚠️ MEASURED, BOTH ARMS, one field apart: codex-shaped idle -> `idle`
       (the blocked state gone), claude-shaped idle with auto -> `blocked`.
       #900 was fixed on the Claude path and the fix was a flag a caller has
       to remember; this bridge was written against the route's field list
       rather than against the rule, so it omitted the one field that is not
       about the report's content. Nothing failed: the report is accepted,
       `recorded: true`, and the loss lands on the next turn. */
    auto: true,
    from_pane: process.env.TMUX_PANE || '',
  });

  const headers = headersFor(process.env);

  // #1765: one deadline for the proof and the report (see mayCarry).
  const deadline = Date.now() + TIMEOUT_MS;
  const controller = new AbortController();
  let timer = null;
  mayCarry(port, headers, undefined, Math.floor(TIMEOUT_MS / 2)).then((ok) => {
    const left = deadline - Date.now();
    if (!ok || left <= 0) return null;
    timer = setTimeout(() => controller.abort(), left);
    return fetch(`http://127.0.0.1:${port}/api/report`, { method: 'POST', headers, body, signal: controller.signal, redirect: 'manual' });
  }).catch(() => { /* a missed report must never become a failed turn */ })
    .finally(() => clearTimeout(timer));
}

/* #5812 item 2: the HOOK mode. engine/codexhooks.js installs a PreToolUse hook (matcher apply_patch) that runs this
   file with the event as JSON on STDIN and no argument; notify always passes its event as the argument, so the two
   cannot be confused. MEASURED on codex-cli 0.149.1 (card comment 6219788459): tool_name "apply_patch",
   tool_input.command = the whole patch text, cwd = the agent's folder, session_id. A patch names its files on
   `*** Add File: `, `*** Update File: `, `*** Delete File: ` and `*** Move to: ` lines, relative to cwd or absolute.
   Each one gets the board's keep call (#5153's copy while the undo switch is on, and #5812's writer record), the same
   call the Claude and Gemini hooks make. Nothing is printed: Codex runs the tool when the hook says nothing. */
const KEEP_TIMEOUT_MS = 3000;   // never hold the edit longer (the Claude and Gemini hooks' bound)
const STDIN_TIMEOUT_MS = 2000;  // a hook closes stdin at once; this only bounds a stdin left open
const KEEP_MAX = 20;            // a patch naming more files gets the first 20 (each is a request to the board); the rest get no undo copy and no changed-by, a stated limit
/* Review 3, measured: Codex accepts a heading with spaces before it and trims the END of the path, so both are allowed
   here (a path keeping trailing spaces named a file that does not exist; an indented heading got no keep at all).
   Review 5, measured with Codex's own patch engine: everything after the one space of ": " IS the path, leading spaces
   included (`*** Add File:  x` creates " x"), and a heading with no space after the colon is refused, so neither is
   trimmed nor accepted here. Review 4,
   measured: inside an Update hunk a line starting with a space is CONTEXT to Codex, never a heading, even when its text
   reads like one; a keep for it would record this agent as the writer of a file it never touched. So an indented
   heading counts only outside an Update hunk. */
const FILE_LINE = /^(\s*)\*\*\* (Add File|Update File|Delete File|Move to): (.*\S)\s*$/;

/* The files a patch names, in order, once each. A path with a control character gets no keep (no guessing at what it
   names). */
function patchPaths(patch) {
  if (typeof patch !== 'string') return [];
  const out = [];
  let inUpdate = false;   // after an Update File (or its Move to) heading, until the next heading
  for (const raw of patch.split('\n')) {
    const m = FILE_LINE.exec(raw.replace(/\r$/, ''));
    if (!m) continue;
    const [, indent, kind, p] = m;
    if (indent && inUpdate) continue;   // a context line that reads like a heading
    inUpdate = kind === 'Update File' || kind === 'Move to';
    if (/[\u0000-\u001f\u007f]/.test(p) || out.includes(p)) continue;
    out.push(p);
  }
  return out;
}

/* The keep bodies for one hook event, or [] (any other event or tool, no patch, a relative path with no cwd, a cwd with
   a control character). */
function keepRequestsFor(event) {
  if (!event || typeof event !== 'object' || event.hook_event_name !== 'PreToolUse' || event.tool_name !== 'apply_patch') return [];
  const input = event.tool_input && typeof event.tool_input === 'object' ? event.tool_input : {};
  const cwd = typeof event.cwd === 'string' ? event.cwd : '';
  if (/[\u0000-\u001f\u007f]/.test(cwd)) return [];
  const session = typeof event.session_id === 'string' ? event.session_id : '';
  const P = require('node:path').posix;
  const out = [];
  for (const file of patchPaths(input.command)) {
    if (!P.isAbsolute(file) && !P.isAbsolute(cwd)) continue;
    out.push({ path: P.isAbsolute(file) ? file : P.resolve(cwd, file), cwd, session });
    if (out.length >= KEEP_MAX) break;
  }
  return out;
}

/* Review 1: stdin is let go once read (or on the timeout), so a stdin left open cannot keep this process, and the edit
   behind it, waiting after the keeps are sent. */
function readStdin(timeoutMs) {
  return new Promise((resolve) => {
    let data = '';
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try { process.stdin.destroy(); } catch { /* already gone */ }
      resolve(data);
    };
    try {
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (c) => { data += c; });
      process.stdin.on('end', finish);
      process.stdin.on('error', finish);
    } catch { finish(); }
    setTimeout(finish, timeoutMs).unref();
  });
}

async function hookMain(io) {
  const o = io || {};
  const env = o.env || process.env;
  const raw = o.input !== undefined ? o.input : await readStdin(STDIN_TIMEOUT_MS);
  let event;
  try { event = JSON.parse(raw || ''); } catch { return; }
  const keeps = keepRequestsFor(event);
  if (!keeps.length) return;
  const port = Number(env.KOSMOS_PORT) || 16180;
  const headers = o.headers || headersFor(env);
  const doFetch = o.fetchImpl || fetch;
  // #1765: one deadline for the proof and the keeps (see mayCarry).
  const bound = o.keepTimeoutMs || KEEP_TIMEOUT_MS;
  const deadline = Date.now() + bound;
  if (!(await mayCarry(port, headers, doFetch, Math.max(1, Math.floor(bound / 2))))) return;
  const left = deadline - Date.now();
  if (left <= 0) return;
  await Promise.all(keeps.map((body) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), left);
    return Promise.resolve()
      /* The answer is read under the same timer (review 3: a board that sent its headers and stalled its body held the
         hook 20 s once the timer was cleared on the headers). */
      .then(() => doFetch(`http://127.0.0.1:${port}/api/undo/keep`, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal, redirect: 'manual' }))
      .then((res) => (res && typeof res.text === 'function' ? res.text() : null))
      .catch(() => { /* a missed keep must never stop the edit */ })
      .finally(() => clearTimeout(timer));
  }));
}

if (require.main === module) {
  if (process.argv.length > 2) {
    try { main(); } catch { /* same rule at the top: never break the agent */ }
  } else {
    hookMain().catch(() => { /* never break the agent */ });
  }
}

module.exports = { patchPaths, keepRequestsFor, hookMain, headersFor, KEEP_MAX, KEEP_TIMEOUT_MS, TIMEOUT_MS };
