# awayresume-9057: a Windows resume long after a quit is reminded of its own wait (#9057)

Built on PigeonPete's `waitresume-9049` (#9049, not on main yet); rebased onto main once it lands.

## Problem
#9049's Windows hook asks GET /api/away?as=waithook at a /clear or a resume, with its agent token and no report. On a
Windows board the token passes resolveAgentSender only through a roster row or a heartbeat younger than
liveness.STALE_AFTER_MS (180 s). A resume after an older quit has neither, so it got 403 and an empty body, and the
reminder was lost. Silent, never false.

## Decision
The card's second way: resolveAgentSender takes `waitAsk`, the away route passes it only for as=waithook from this
computer (loopback, not remote), and it admits the token through the same startedMayProveLife check a `started` report
uses (a board on Windows, a token not issued to another computer, an agent Kosmos launched here or has a profile for,
not removed). The route writes no heartbeat and no report, and answers only that token's agent.
Rejected: an automatic report at a resume (writes a state and a heartbeat; puts #1058 back in question).
Weakest premise: a read-only answer about one's own wait needs no more proof than a `started`, which today gets the same
check and writes a heartbeat as well. Not run on a real Windows board.

## Kept true (PigeonPete, m6517)
- A refused caller still gets the empty body, never {"pending":true} (pinned: Mac control, never-issued, revoked).
- An older board answers as=waithook with plain JSON that both hooks drop: hooks are unchanged.
- "pending" is never printed: hooks are unchanged; the route's pending answer is only for an admitted caller, as before.

## Tests
server.away-9049.test.js: one #9057 test (Mac control 403 empty; Windows 200 with the reminder; no heartbeat and no
report written; startup and by-hand forms not widened; never-issued and revoked refused). Control: it fails at the 403
without the server change. Neighbours green: server.startedproof-8372, server.away-8548/8634/9049, the waitresume hook
test, report-hook-away-8548, cli.away-8548, engine.reachable, server.paneless-sender.
