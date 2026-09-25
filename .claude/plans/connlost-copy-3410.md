# Plan: #3410, say what Kosmos is doing about a lost connection

## Finished looks like
A card whose agent lost its API connection says, in plain words, what Kosmos is doing about it:
"Reconnecting…" (calm, not red) with "Kosmos will retry once it is back" or "Kosmos asked it to try
again" while the self-heal (#3667) still has retries to give; the red "Connection lost" with
"Still can't connect after several tries. Check this Mac's internet, then restart it." once it has
given up; and the unchanged "Connection lost / Looks like it lost its internet connection" when
the self-heal is not running, so the page never promises a retry nobody will send.

## Why
Splinter 2026-09-25 04:47: the "reconnecting…" wording was Mona Lisa's, but wording is reversible,
so Angel writes it, ships it, and Mona reviews after. Before this, the card read red "Connection
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
- "Reconnecting…": says Kosmos is on it; calm because there is nothing for the person to do yet.
- "Kosmos will retry once it is back" / "Kosmos asked it to try again": what the heal actually
  does (it types one retry message when the API is reachable; it does not restart).
- Gave up: "several tries" not "3", so the sentence stays true if the cap changes; "check this
  Mac's internet, then restart it" is the next step a person can take (the card's restart).

## Rejected
- A copy-only change ("Kosmos will retry...") with no engine field: false after the heal gives up
  or when it is switched off.

## Measured
Tests 31/31 (web + engine). Red control: the new page wording tests fail 3 of 12 against the old
page.

## Weakest premise
The heartbeat check-in question for connection_lost ("lost its connection. Reconnect it, or is it
done?") can still fire while the card says Reconnecting; left as is (it is a question, not a
contradiction), noted for Mona's review.
