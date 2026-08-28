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
    from_pane: process.env.TMUX_PANE || '',
  });

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
  const token = String(process.env.KOSMOS_AGENT_TOKEN || '').trim();
  if (/^[0-9a-f]+$/.test(token)) headers['x-kosmos-agent-token'] = token;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  fetch(`http://127.0.0.1:${port}/api/report`, {
    method: 'POST',
    headers,
    body,
    signal: controller.signal,
  }).catch(() => { /* a missed report must never become a failed turn */ })
    .finally(() => clearTimeout(timer));
}

try { main(); } catch { /* same rule at the top: never break the agent */ }
