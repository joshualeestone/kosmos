# Plan: #3410, say what Kosmos is doing about a lost connection

## Finished looks like
A card whose agent lost its API connection says, in plain words, what Kosmos is doing about it:
"Reconnecting…" (the label; the card keeps its paused look) with "Kosmos will retry once it is back" or "Kosmos is asking it to
try again" while the self-heal (#3667) still has retries to give; "Connection lost" with
"Still can't connect after several tries. Check this computer's internet connection, then restart the agent. It will start fresh." once it has
given up; and the unchanged "Connection lost / Looks like it lost its internet connection" when
the self-heal is not running, so the page never promises a retry nobody will send.

## Why
Splinter 2026-09-25 04:47: the "reconnecting…" wording was Mona Lisa's, but wording is reversible,
so Angel writes it, ships it, and Mona reviews after. Before this, the card read "Connection
lost" for the whole two-minute window in which Kosmos was about to fix it by itself, which tells
the person to act when they need not.

## Change
- engine/connlost-heal.js: `reconnectPhase(entry, enabled)` -> null | {phase: waiting|retried|gave_up, tries}.
- server.js: the self-heal book moves to module scope (CONNLOST_BOOK) so /api/status can read it;
  each card gets `reconnect` (null unless connection_lost; null when the heal is off: live
  execution not allowed or AGENT_WORKFORCE_CONNLOST_HEAL_OFF=1).
- web/index.html: stateCopyOf returns "Reconnecting…" (attn false) for waiting/retried;
  stateReason adds the sentence per phase.

## Wording, and why
- "Reconnecting…": says Kosmos is on it; there is nothing for the person to do yet. The card keeps
  its paused look and icon (a design question for Mona).
- "Kosmos will retry once it is back" / "Kosmos is asking it to try again": what the heal actually
  does (worded as an attempt: the sweep counts a retry whether or not it landed) (it types one retry message when the API is reachable; it does not restart).
- Gave up: "several tries" not "3", so the sentence stays true if the cap changes; "check this
  computer's internet connection, then restart the agent. It will start fresh." names the agent (not the computer) and says a
  restart loses its in-progress work, which the self-heal avoids.

## Rejected
- A copy-only change ("Kosmos will retry...") with no engine field: false after the heal gives up
  or when it is switched off.

## Measured
Tests 31/31 (web + engine). Red control: the new page wording tests fail 3 of 12 against the old
page.

## Known and left
- "waiting" has no time limit: if the network never comes back the card says Reconnecting until
  it does (the sentence stays true).
- For the moment between the third retry being recorded and it landing, the card already says it
  gave up.

## Weakest premise
The heartbeat check-in question for connection_lost ("lost its connection. Reconnect it, or is it
done?") can still fire while the card says Reconnecting; left as is (it is a question, not a
contradiction), noted for Mona's review.
