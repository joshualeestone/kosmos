#!/usr/bin/env node
'use strict';

/**
 * The codex side of self-reporting (#245, on #526's interface): codex's
 * `notify` hook runs this with one JSON argument per event, and this
 * translates the event into the report vocabulary and posts it to the
 * board's /api/report — the same record `kosmos report` writes, arriving
 * with the same evidence property, because codex runs INSIDE the agent's
 * tmux pane and this child inherits TMUX_PANE, which is the identity the
 * route resolves. No sender argument exists to forge.
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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  fetch(`http://127.0.0.1:${port}/api/report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    signal: controller.signal,
  }).catch(() => { /* a missed report must never become a failed turn */ })
    .finally(() => clearTimeout(timer));
}

try { main(); } catch { /* same rule at the top: never break the agent */ }
