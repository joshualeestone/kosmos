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
