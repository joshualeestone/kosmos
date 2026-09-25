# Plan: #3410, say what Kosmos is doing about a lost connection

## Finished looks like
A card whose agent lost its API connection says, in plain words, what Kosmos is doing about it:
"Reconnecting…" (the label; the card keeps its paused look) with "Kosmos will retry it automatically" or "Kosmos has asked it to
try again" while the self-heal (#3667) still has retries to give; "Connection lost" with
"Kosmos tried to reconnect it several times and has stopped. If the internet is working, restart the agent. It will start fresh." once it has
given up; and the unchanged "Connection lost / Looks like it lost its internet connection" when
the self-heal is not running, so the page never promises a retry nobody will send.

## Why
Splinter 2026-09-25 04:47: the "reconnecting…" wording was Mona Lisa's, but wording is reversible,
so Angel writes it, ships it, and Mona reviews after. Before this, the card read "Connection
lost" for the whole two-minute window in which Kosmos was about to fix it by itself, which tells
the person to act when they need not.

## Change
- engine/connlost-heal.js: `reconnectPhase(entry, enabled)` -> null | {phase: waiting|retried|gave_up, tries}.
- engine/connlost-heal.js: `healEnabled(allowed, env)`, the one "does the sweep run" rule, read by
  both the sweep and the route.
- server.js: the self-heal book moves to module scope (CONNLOST_BOOK) so /api/status can read it;
  each card gets `reconnect` (null unless connection_lost; null when the heal is off: live
  execution not allowed or AGENT_WORKFORCE_CONNLOST_HEAL_OFF=1).
- web/index.html: the project members list (pjMember) borrows `reconnect` from the same agent
  in the latest status (LAST), so it agrees with the card.
- web/index.html: stateCopyOf returns "Reconnecting…" (attn false) for waiting/retried;
  stateReason adds the sentence per phase.

## Wording, and why
- "Reconnecting…": says Kosmos is on it; there is nothing for the person to do yet. The card keeps
  its paused look and icon (a design question for Mona).
- "Kosmos will retry it automatically" / "Kosmos has asked it to try again": what the heal actually
  does (worded as an attempt: the sweep counts a retry whether or not it landed) (it types one retry message when the API is reachable; it does not restart).
- Gave up: "Kosmos tried to reconnect it several times and has stopped. If the internet is
  working, restart the agent. It will start fresh." The sweep only retries once it can reach the
  API, so a give-up usually means the agent is stuck, not the internet; the give-up can outlast
  one outage (the retry budget spans drops until the agent has been fine for 10 minutes and the last retry is 30 minutes old), so the sentence says tries were
  made, not that they were made this time. "Several", not "3", so it stays true if the cap
  changes. Names the agent (not the computer); "It will start fresh." tells the person a restart does not pick up where it left off.

## Rejected
- A copy-only change ("Kosmos will retry...") with no engine field: false after the heal gives up
  or when it is switched off.

## Measured
Tests: web + engine + the server route test all pass; browser check render-connlost-reconnect-3410
(card label and sentence per phase, plus the page's own members-list renderer, called with a member row, agreeing with the card). Red control: the new page wording tests fail 3 of 12 against the old
page.

- "Retried" counts only retries sent in this drop (connlost-heal.js lostSince); the planner's cap
  still spans drops, as designed.
- The 15-minute check-in no longer asks the person to reconnect an agent Kosmos is reconnecting.

- A drop the sweep has not seen yet (the entry still reads recovered) says Reconnecting with no retry this drop, even if an earlier drop was retried.

## Known and left
- "waiting" has no time limit: if the network never comes back the card says Reconnecting until
  it does (the sentence stays true).
- For the moment between the third retry being recorded and it landing, the card already says it
  gave up.

## Weakest premise
That every surface showing connection_lost reads it through stateCopyOf/stateReason/the check-in,
the three places changed here; a new surface that reads STATE_COPY directly would show the old
label. Checked by grep today.
