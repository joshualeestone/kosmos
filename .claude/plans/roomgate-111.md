# roomgate-111: #111's safety gate becomes a test

Card: #111 (PR two of answer-panel would delete the room's question box; it waits on two gates).

## Checked against origin/main 7908b3235 (2026-09-27)
- Gate 2 (question width): DONE, #113 closed 2026-08-23.
- Gate 1 (the agent page carries a blocking question a person can see and answer, Splinter's 08-19 ruling): OPEN;
  needs a browser walk across question states. Not attempted here.
- PR two has not landed and nobody is building it: `id="pj-question"` is at web/index.html:14247 inside
  `id="pj-thread"` (14233); the 08-20 durable guard `grep -c "pj-question\|pj-thread"` = 51 (pass: != 0); no PR
  or branch for the delete exists.

## Why a test
The gate lived in a branch plan, then on a card. A card guards only while someone reads it. Three existing tests
touch the box (web.fold-boxes, web.pj-clear-state-2575, render-thread), but each would fail for its own feature's
reason, so a person deleting the box would update them and never meet Gate 1. `web.room-question-gate-111.test.js`
fails if `#pj-thread` or `#pj-question` disappears (or the box leaves the thread), and its message states the gate
and whose OK relaxes it. With the rule in the suite, the card can close.

## Evidence
- Passes on main. Control: renaming `id="pj-question"` in a working copy fails exactly this test with the gate
  message; restored.

## Rejected
- Keeping #111 open indefinitely for a PR nobody is building: the weaker guard.
- Asserting the grep count (51): it rots with every unrelated edit to those classes; the ids are the contract.
