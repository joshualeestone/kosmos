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
engine/messages.js, sendPostWithDelivery's asynchronous arm: every member's delivery starts at once
(Promise.allSettled over recipients.map(deliverOne)); after all have finished, the first failure is thrown, else the
deliveries are finished as before. The synchronous arm (sendPost) is unchanged.

## Why overlapping is safe
- Each member is its own pane, and chat.deliverAsync already queues deliveries to one pane (deliveryQueues).
- What deliverOne shares between members (outcomes, spilled, roomhold's held ids) is keyed by the member's name.
- deliverOne's synchronous part (the checks, the envelope, the paste) still runs member by member, in order; only
  the waits overlap. The tmux calls themselves are synchronous (spawnSync), so they never interleave.

## Decisions
1. Wait for EVERY member before answering, then throw the first failure (allSettled, not all). Rejected: Promise.all,
   which would answer "could not post" while other members were still being typed at.
2. On purpose, one change on the failure path: the old loop stopped at a member whose typing THREW, so the members
   after it were never tried; now they are. A throw there is a broken promise in the typing path (chat.deliverAsync
   reports its failures as verdicts, not throws), so this is rare.
WEAKEST PREMISE: that nothing downstream depended on members being typed at strictly one after another (for
example an agent reading the room and seeing a colleague's copy arrive first). Every member still gets the same
envelope; only the gaps overlap.

## Tests
- engine/messages.fanout-4765.test.js (new): every member's wait is open at the same time (counted, not timed), all
  placed, the pastes go in in the members' order; and when one member fails, the others are still reached and the
  failure is reported only after all have finished. Both tests FAIL against the old loop (1 open at once; the failure
  reported before the others were reached).
- 362 of 362 across the room-post and delivery tests (the messages and chat engine suites, the server post and room
  tests, the agent-token sender pins).

## Not done
- Nothing measured on a real room with real agents (a real post would type into them).
- The page still waits for the POST before it shows the post; showing it at once (optimistic) would take the wait
  to zero, and is a design change for its own card.
