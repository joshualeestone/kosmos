# pnflake-4136: phonenotify "one turn-on at a time" test overlaps deterministically (kosmos#4136)

## Problem
server.phonenotify-718.test.js fired two HTTP PUTs with Promise.all and asserted one mint. turnOn shares the promise of
a turn-on IN FLIGHT; two turn-ons one after the other each mint, correctly. On a loaded Mac (load 31, modelid-4111's
validation) the first request finished its mint before the second reached turnOn, and the test counted 2.

## Change (test only)
- For this test the fake tunnel logs its call, then waits for a gate file before answering.
- phonenotify.turnOn is wrapped for the test: the SECOND arrival opens the gate (synchronously, before calling the real
  turnOn, so the first mint cannot have finished). A 20s fallback opens it anyway so a missing request fails the
  assertions rather than hanging the run.
- New assertion: both requests reached turnOn. The mint count assertion is unchanged.

## Evidence
- Green 3/3. With the collapse removed from engine/phonenotify.js (turnOn -> doTurnOn every call): red 3/3.
- The original red is not reproduced (it needed load); the mechanism is read from the code.

## Rejected
- Calling phonenotify.turnOn() twice directly: loses the HTTP path the test is named for.
- A sleep in the fake tunnel: still a timing guess.

## Challenge loop record
### Iteration 1 (opus): 2 WARNINGs, 3 NITs, all fixed; plus a defect my own perturbation found.
- W: the test never checked the turn-ons succeeded; both answers must be 200 with on:true and state on.
- W: the 20s fallback equalled the tunnel's own 20s timeout; the test now raises AGENT_WORKFORCE_MAC_REQUEST_TIMEOUT_MS
  to 90s, with the fallback at 45s and the gate loop at about 60s, and the arrival assertion says a late arrival
  makes the mint count meaningless.
- N: the sibling "turning off while a turn-on is still minting" test used 150ms against a 1s mint; it now sends the
  off only once the mint has started and holds the mint until the off reaches turnOff. Perturbation (turnOff no
  longer waits for the turn-on): red 2/2.
- N: one LOG_CALL shared by the fake tunnels; the misleading catch removed.
- FOUND WHILE CHECKING: with the collapse removed, the one-at-a-time test still PASSED 1 run in 5. Instrumented: two
  tunnels running at once interleaved their log pieces ("ARGV:ARGV: mac-request ..."), so the count saw one mint.
  The old test had the same latent false pass. LOG_CALL is now a single printf (one append). Perturbation now red 8/8.
### Iteration 2 (sonnet): CONVERGED. NITs only, accepted: `answers` undefined if Promise.all rejected (the route
always answers with a status, so the call resolves); the gated tunnel body repeated in two tests (two short,
commented sites).
