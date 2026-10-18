---
pre_challenge: true
method: challenge-loop
branch: roomcap-6420
diff_hash: c1a7086f80e2eddd1b25561d7cc0835bff1ea2a5017377582e2c539fd1342cc5
validation: passed
subdir_audit: passed
timestamp: 2026-10-17T23:04:33Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10
**Converged:** Yes (iteration 10: 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT)
**Total findings:** 0 BLOCKERs, 22 WARNINGs, 4 CONVENTIONs across 10 iterations (plus 25 NITs)
**Fixed:** 21 WARNINGs and one CONVENTION | **Not a defect:** 1 WARNING (below) | **Deferred:** 3 CONVENTIONs (below) | **Asked:** 0

Validation (6j): tools/run-tests.sh through queued-heavy at caafd21b, the reviewed commit, rebased onto main after
its base (#6428) merged: node 21598 tests, 21331 pass, 0 fail, 0 cancelled, 267 skipped; shell shard 246 of 246
passed; browser-check surface gate 0 FAILED; RUN_EXIT=0.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] the room route sized the room from the raw registry, counting agents removed from Kosmos, unlike the valve
  --> FIXED (messages.roomRecipientsOf, shared by the route and the valve's sizing; a route test with a removed member)
- [WARNING] mobile-shots.js mirrored the route's raw size --> FIXED (it sizes the room with roomRecipientsOf)
- [WARNING] the weakest premise left out the doubled progress allowance (400 an hour with progress, not 160) --> FIXED
  (stated in the plan and the roomCap comment)

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] the roomHeld docblock said a null `until` means one post is over the whole budget --> FIXED
- [WARNING] the HELD_MEMO comment did not name the new `size` field --> FIXED
- [CONVENTION] the scaling comment sat above roomRecipientsOf and roomCap had none --> FIXED (each has its own)

#### Iteration 3
**Reviewer model:** opus
- [WARNING] x2 (engine/limits.js header and the messages.js valve block still said "four times" for every room) -->
  FIXED (both name the floor and roomCap)
- [WARNING] the multiplier had no ceiling, so cost grew without limit with the room --> FIXED (ROOM_SCALE_MAX, four
  times the dial; the plan's table and premise state the bound)
- [WARNING] the nudge's new size argument had no guard --> FIXED (a nudge test at the exact edge, 195 and 205
  arrivals in a six-member room)
- [CONVENTION] the nudge re-derives the size inline instead of calling roomRecipientsOf --> DEFERRED: room.members is
  already _roomMembers' list, and calling roomRecipientsOf filtered it twice (iterations 5 and 7 NITs); the comment
  names the equivalence and the edge test pins the size

#### Iteration 4
**Reviewer model:** sonnet
- [WARNING] the plan's table gave a 20-member room 17 posts; 16 fit --> FIXED (16, with the ceiling named)
- [WARNING] the "held past the scaled budget" test passed under the old cap too --> FIXED (195 arrivals open at the
  room's size, held at the dial's as a CONTROL, 205 refused)
- [WARNING] with a duplicate project id the route reads `stored[0]` while the valve reads projects.get --> NOT A
  DEFECT: iteration 5 traced projects.get to the first match, the same record

#### Iteration 5
**Reviewer model:** opus
- [WARNING] "no single post can be bigger than the budget" is false past the ceiling --> FIXED (the comment says below
  the ceiling; a test past it at the lowest dial, 161 recipients, is refused with no clear time)
- [WARNING] the plan's "Known edge" about duplicate ids describes a risk the code does not have --> FIXED (removed)

#### Iteration 6
**Reviewer model:** sonnet
- [WARNING] no test covered the scaled progress allowance or the scaled clear time --> FIXED (six-member tests: one
  step earns a quarter of the scaled budget, and the clear time is read at the scaled budget)

#### Iteration 7
**Reviewer model:** opus
- [WARNING] x2 (the test comment and the plan said the clear time "would be 55 minutes off"; it is 45) --> FIXED (both
  say "55 minutes away instead of 10")
- [WARNING] no test pinned roomHeldRead's own allowance read at a scaled cap --> FIXED (the allowance test also reads
  roomHeld at the room's size, which takes that path)

#### Iteration 8
**Reviewer model:** sonnet
- [WARNING] the nudge test was far from the boundary --> FIXED (the 195 and 205 edge; a size off by one fails it)
- [WARNING] mobile-shots did not check that the project was found or the seed held --> FIXED (it stops with a clear
  error in either case)
- [WARNING] the plan claimed an assertion the 205-arrival test did not make --> FIXED (it asserts roomHeld at the
  room's size after the hold)
- [CONVENTION] ROOM_SCALE_MAX is defined mid-file --> DEFERRED: it sits beside roomCap as HELD_MEMO_MS and
  ROOM_PROGRESS_STEPS sit beside their readers in this file
- [CONVENTION] the plan file name has no timestamp --> DEFERRED: the sibling plans in this repo carry none and the plan
  hook accepts it

#### Iteration 9
**Reviewer model:** opus
- [WARNING] the nudge test's comment described 100 arrivals; the test checks the 200-arrival edge --> FIXED

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Converged**: no new actionable findings.

### Strengths
- One budget function (roomCap) and one sizing function (roomRecipientsOf) for the valve, the progress allowance, the
  room route and the hold read, each pinned at its exact edge with a CONTROL read at the dial's budget.
