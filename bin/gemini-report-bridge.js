#!/usr/bin/env node
'use strict';

/**
 * The Gemini side of self-reporting (#3296), the analog of
 * bin/codex-report-bridge.js. Gemini-cli has its OWN hook system (configured in
 * the agent's gemini settings.json, exactly like Claude Code's reporthook path,
 * NOT codex's launch-time `notify` flag). On each lifecycle event it runs this
 * script from INSIDE the agent's tmux pane, passing the event payload as JSON on
 * STDIN (not argv, which is codex's shape). This child inherits TMUX_PANE, which
 * is the identity /api/report resolves -- the same evidence property as
 * `kosmos report` and the codex bridge.
 *
 * ⚠️ A PANE ID IS ITSELF A CLAIM (same caveat as the codex bridge): ids are
 * enumerable and the board has no auth, so a local process can pass another
 * agent's pane. The launch token below is the stronger identity when present.
 *
 * 🔑 GEMINI CAN REPORT ITS FULL LIFECYCLE, richer than codex's single event,
 * because gemini's hook events map cleanly to the report vocabulary (measured
 * against the installed bundle, 2026-09-23):
 *   SessionStart {source}                       -> started
 *   BeforeAgent  {prompt}                        -> working   (a turn started)
 *   Notification {notification_type,message}     -> needs_you (a tool needs the
 *       person; under `--approval-mode yolo` benign confirmations are
 *       auto-approved and never fire this, so a Notification that DOES fire is a
 *       genuine "yolo could not auto-handle" attention signal -- message carries
 *       the reason the route requires for needs_you)
 *   AfterAgent   {prompt,prompt_response}        -> idle      (turn complete;
 *       prompt_response is the last words, so the card can say what it finished
 *       with -- the analog of codex's last-assistant-message)
 *   SessionEnd   {reason}                        -> stopped
 * The one hook this script is wired for but does NOT map is any event outside
 * that list: an unknown hook_event_name is ignored, not guessed at -- the same
 * "observe, don't invent" rule as the codex bridge.
 *
 * ⚠️ THIS MUST NEVER BREAK THE AGENT. Every failure is swallowed; the exit code
 * is always 0; the POST has a short timeout. A board that is down costs a
 * report, never a turn.
 */

const TIMEOUT_MS = 5000;

/* The gemini hook_event_name -> (report state) map. `auto: true` on ALL of them
   because the MACHINE is writing this, not the agent: the route's #900/#1949/#2456
   guards keep an automatic idle/working/needs_you from erasing a DELIBERATE
   blocked/needs_you the agent filed during the turn. Without `auto`, a turn
   ending (AfterAgent -> idle) seconds after the agent filed `blocked` would erase
   it -- exactly the bug the codex bridge's #1456 comment documents. */
const STATE_FOR_EVENT = Object.freeze({
  SessionStart: 'started',
  BeforeAgent: 'working',
  Notification: 'needs_you',
  AfterAgent: 'idle',
  SessionEnd: 'stopped',
});

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(data); } };
    try {
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => { data += chunk; });
      process.stdin.on('end', finish);
      process.stdin.on('error', finish);
      /* A hook that is invoked with no stdin attached must not hang the child
         (and thus stall gemini waiting on its hook). Resolve on a short timer if
         no `end` arrives; the empty body is then parsed as nothing and ignored. */
      setTimeout(finish, TIMEOUT_MS).unref?.();
    } catch { finish(); }
  });
}

/* The pure event -> report translation, exported for tests. Returns { state, text }
   or null for an event we do not map. Kept side-effect-free so the mapping (the
   thing most likely to drift) is testable without a live board. */
function reportFor(event) {
  if (!event || typeof event !== 'object') return null;
  const state = STATE_FOR_EVENT[event.hook_event_name];
  if (!state) return null; // an unobserved event is ignored, never guessed at
  /* The last words for the card (idle), or the reason a needs_you requires. For
     needs_you the route REFUSES an empty note (selfreport.js: a needs_you/blocked
     must carry a reason/on/owner), so a Notification with no message would be
     dropped -- fall back to a plain, honest sentence so the red still lands. */
  let text = '';
  if (state === 'idle') {
    text = typeof event.prompt_response === 'string' ? event.prompt_response : '';
  } else if (state === 'needs_you') {
    text = (typeof event.message === 'string' && event.message.trim())
      ? event.message
      : 'the agent is waiting for a person';
  }
  return { state, text };
}

async function main() {
  const raw = await readStdin();
  let event;
  try { event = JSON.parse(raw || ''); } catch { return; }

  const mapped = reportFor(event);
  if (!mapped) return;
  const { state, text } = mapped;

  const port = Number(process.env.KOSMOS_PORT) || 16180;
  const body = JSON.stringify({
    state,
    // The engine caps this; the words stay on this Mac (selfreport.js's note).
    text,
    on: '',
    owner: '',
    until: '',
    auto: true,
    from_pane: process.env.TMUX_PANE || '',
  });

  /* Present the launch token when we have one (the supervisor mints it per launch
     and puts it in the pane env). Same hex shape-test as the codex bridge: a
     partial write or a stray warning on stdout must not turn a working report into
     a silent refusal on an enforcing board. Silence is the safe default -- an
     agent launched before the mint has no token here and is identified by its pane
     exactly as before. */
  const headers = { 'content-type': 'application/json' };
  const token = String(process.env.KOSMOS_AGENT_TOKEN || '').trim();
  if (/^[0-9a-f]+$/.test(token)) headers['x-kosmos-agent-token'] = token;

  /* Also present the board token (the same-account credential an enforcing board
     accepts instead of a bare pane). Read via boardauth, the ONE source of truth
     for the path. Guarded to this file's cardinal rule: a token we cannot read
     must never break the agent. */
  try {
    const boardTok = require('../engine/boardauth').readToken();
    if (typeof boardTok === 'string' && boardTok) headers['x-kosmos-board-token'] = boardTok;
  } catch { /* a missed board token must never become a failed turn */ }

  /* Name this agent's Kosmos, so a board serving ANOTHER Kosmos answers 421
     rather than refusing the report as a stranger's. Same guard as above. */
  try {
    const launchidentity = require('../engine/launchidentity');
    headers[launchidentity.WORLD_HEADER] = launchidentity.worldHeaderValue(process.env);
  } catch { /* a missed world header must never become a failed turn */ }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  await fetch(`http://127.0.0.1:${port}/api/report`, {
    method: 'POST',
    headers,
    body,
    signal: controller.signal,
  }).catch(() => { /* a missed report must never become a failed turn */ })
    .finally(() => clearTimeout(timer));
}

/* Run only when invoked directly (as gemini's hook does); when required as a
   module (the unit test) expose the pure mapping without firing a POST. */
if (require.main === module) {
  main().catch(() => { /* same rule as the top: never break the agent */ });
}

module.exports = { STATE_FOR_EVENT, reportFor };
