# #4765 cause 1: a room post reaches its members at once, not one after another

Card: joshualeestone/kosmos#4765 (claimed:angel, priority). Branch roomfanout-4765, off main 91890bc75.
Addresses #4765 (cause 2, the Agents view repainting, is its own branch).

## What finished looks like
A person's post to a room of N members comes back (and so shows on the page) in about the time of ONE member's
delivery, not N of them, with every member still placed as before and the same verdicts.

## Evidence (measured, on the real engine, fake agents, a fake tmux costing what tmux costs on this Mac)
| members | before | after |
|---|---|---|
| 1 | 0.31 s | 0.31 s |
| 5 | 1.53 s | 0.40 s |
| 10 | 3.06 s | 0.52 s |
| 20 | 6.11 s | 0.80 s |
Each member waits at least 250 ms between paste and Enter (500 ms for Codex, Gemini, Grok, Antigravity), and the
old loop waited for each member before starting the next. The page (pjPostSend) shows the post only after the
POST returns, so that sum was the wait after Enter.

## The change
engine/messages.js, sendPostWithDelivery's asynchronous arm: each member's delivery starts one turn of the event loop
after the one before (a setImmediate between starts), without waiting for it to finish; after all have finished
(Promise.allSettled), the first failure is thrown, else the deliveries are finished as before. The synchronous arm
(sendPost) is unchanged.

## Why overlapping is safe
- Each member is its own pane, and chat.deliverAsync already queues deliveries to one pane (deliveryQueues).
- What deliverOne shares between members (outcomes, spilled, roomhold's held ids) is keyed by the member's name.
- Each member's checks and envelope, then its paste, run member by member, in the members' order (a member whose
  pane already has a delivery queued from another request waits behind that one). The tmux calls are synchronous
  (execFileSync), so no member's Enter can land between another's paste chunks. Only the waits overlap.

## Decisions
1. Wait for EVERY member before answering, then throw the first failure (allSettled, not all). Rejected: Promise.all,
   which would answer "could not post" while other members were still being typed at.
2. On purpose, one change on the failure path: the old loop stopped at a member whose typing THREW, so the members
   after it were never tried; now they are. A throw there is a broken promise in the typing path (chat.deliverAsync
   reports its failures as verdicts, not throws), so this is rare. What it costs, as before but now for every member
   rather than only the earlier ones: on a failure the post is not recorded (finishDeliveries is skipped), yet the
   members who were typed at got an envelope naming its id, and the next post will reuse that id.
3. One member per turn, not all in the same tick (review 1). Starting all at once ran every member's synchronous tmux
   calls as one block: measured on 20 members, the board went 599 ms without answering anything else (the old loop:
   42 ms; now: 72 ms), while the post itself took the same time either way.
WEAKEST PREMISE: that nothing downstream depended on members being typed at strictly one after another (for
example an agent reading the room and seeing a colleague's copy arrive first). Every member still gets the same
envelope; only the gaps overlap.

## Tests
- engine/messages.fanout-4765.test.js (new): every member's wait is open at the same time (counted inside a 200 ms
  wait, which the starts fall well within), all
  placed, the pastes go in in the members' order; and when one member fails, the others are still reached and the
  failure is reported only after all have finished. Both tests FAIL against the old loop (1 open at once; the failure
  reported before the others were reached).
- 362 of 362 across the room-post and delivery tests (the messages and chat engine suites, the server post and room
  tests, the agent-token sender pins).

## Review round 1 (one blind reviewer, no blocker; one should-fix, three nits, all taken)
1. All members in one tick blocked the event loop for N members' tmux calls (above, decision 3).
2. The plan described the synchronous part wrongly (the paste is not in deliverOne's own synchronous part) and named
   spawnSync for execFileSync. Corrected above.
3. A SYNCHRONOUS throw from deliverOne escaped the map before allSettled, so the failure was told while earlier
   members were still being typed at and later ones were never started. Each start is now inside a promise and
   handled at once. Tested: a member whose delivery throws at once.
4. The failure path's cost (an unrecorded post whose id reached members) now applies to more members. Named in
   decision 2.
Tests added: one member starts per turn (counted with a setImmediate chain, not timed), and the throw-at-once case.
Both fail against the reviewed commit, which started all members in one tick.
Bench after the round (20 members): 0.98 s, longest stall 72 ms. 364 of 364 across the room-post and delivery tests.

## Review round 2 (a second blind reviewer, whole branch): no blocker, no should-fix, two nits taken. CONVERGED.
1. The comment implied the per-turn start also spreads the Enters; it spreads them only as far as the starts:
   waits due together still end in one turn (2 or 3 members' Enters per turn on 20, measured by the reviewer).
2. "Counted, not timed" overstated the first test, which relies on the starts landing inside the wait; the wait is
   now 200 ms (the starts are 1 to 5 ms apart) and the wording says so.
The reviewer ran the fan-out file 8 times in a row and 12 in parallel with no failure, and three mutants (all in one
tick; the old loop; the catch removed), each failing the test that pins it.

## Not done
- Nothing measured on a real room with real agents (a real post would type into them).
- The page still waits for the POST before it shows the post; showing it at once (optimistic) would take the wait
  to zero, and is a design change for its own card.
