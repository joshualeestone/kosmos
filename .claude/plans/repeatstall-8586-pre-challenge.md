---
pre_challenge: true
method: challenge-loop
branch: repeatstall-8586
diff_hash: 09589eb75e95ccf9d1af05edb8b5a77acbd13a02040cdfeb05fad6430b8ce8fe
validation: passed
subdir_audit: passed
timestamp: 2026-11-16T20:21:03Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped at the 8-round cap (Splinter's standing rule of 2026-10-31: cap 8 rounds unless a BLOCKER is open; leftovers go on a card). Round 8 found no BLOCKER and one WARNING, a documented trade-off.
**Total findings:** 0 BLOCKERs, 19 WARNINGs, 1 CONVENTION, about 25 NITs
**Fixed:** 18 | **Deferred:** 2 | **Asked (awaiting user):** 0

**Validation:** focused, as this repo's practice for an engine change (the full suite runs in CI): every test file that reads repeatdue, missedtell or the reviewer and told fields, plus the standing guards (fixture-discipline, cli.sandbox-data-4796, no-brand-refs-1881, no-name-refs-3071). Final run on 133549ccc1: 184 pass, 0 fail. Mutation checks, each measured: the once-per-stall check removed fails the stall tests; the item-2 rule reverted to asking owed() fails the minutes reviewer-holder test; the tasks.js deletions removed fail the 4787 field lists; the mark-clearing removed fails the three came-back and give-up tests.

**Provenance note:** the first round's code was recommitted as one commit (a soft reset to drop a WIP subject), so blame cannot separate loop-written lines from the original change for round 1's code. Findings on prose the loop wrote were handled by deleting the claim (rounds 2 and 7), not by writing a better one.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 7 NITs
**Self-generated:** 0
- [WARNING] repeatdue-8581.test.js: a test title promised a holder-set arm it did not have --> FIXED (5460955041), arm added
- [WARNING] repeatdue.js / missedtell.js: comments overstated what clears the mark --> FIXED (5460955041)
- [WARNING] tasks.js: dropReviewer and setReviewer did not drop the new marks --> FIXED (5460955041)
- [CONVENTION] a WIP commit subject --> FIXED (recommitted)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 2 (loop-written comments)
- [WARNING] missedtell.js: stacked, partly wrong comments --> FIXED: deleted (3d406be5a9)
- [WARNING] repeatdue.js: the throttle shift during a quiet stall was unstated --> FIXED: in the plan (3d406be5a9)
- [WARNING] repeatdue.js: the minutes residual had no test --> DEFERRED then, removed in iteration 5 (the residual itself is gone)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 0
- [WARNING] tasks.js: the new deletions were untested --> FIXED: seeded field lists (e9d3388107)
- [WARNING] missedtell.test.js: the reviewer-renamed test passed on the key alone --> FIXED: same reviewer named again, and a rule change (e9d3388107)
- [WARNING] mixed holders on a minutes repeat could repeat rows hourly --> documented, then removed with iteration 5's fix

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] missedtell: clearing on a reach untested --> FIXED (a607a1d3f8)
- [WARNING] repeatdue: clearing on give-up after MAX_TRIES untested --> FIXED (a607a1d3f8)
- [WARNING] tasks.repeat-4787: close path did not check the marks --> FIXED (a607a1d3f8)
- [WARNING] the item-2 residual unpinned --> superseded by iteration 5

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 (the item-2 check written before the loop, in the first commit)
- [WARNING] repeatdue.js: asking owed() made both tells speak every hour on a minutes repeat --> FIXED: decided by the naming rule (dd14f16f16), minutes test added, mutation measured
- [WARNING] plan understated that residual --> FIXED: residual removed with the cause (dd14f16f16)
- [WARNING] two unreachable rows for one stall through the same gap --> FIXED by the same change

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 (plan prose)
- [WARNING] plan said "one slot sooner" and the reviewer said "at the next sweep" --> a test measured it: neither was exact; the plan states the measured behaviour (de77dc77da)
- [WARNING] a holder who comes back but is never told keeps the mark --> DEFERRED: by design, now stated in the plan

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION (plan file name without a timestamp; most plans here have none: not changed), 5 NITs
**Self-generated:** 2 (the iteration-6 test and plan sentence)
- [WARNING] the minutes test passed on the old code too --> FIXED: a return after an unrecorded slot, which fails with every slot recorded (measured) (133549ccc1)
- [WARNING] plan claimed a measurement that was reasoned --> FIXED: each claim labelled measured or reasoned (133549ccc1)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 acted on (nothing changed after this round)
- [WARNING] a holder who comes back, is never told, and leaves gets one row for the whole period --> DEFERRED: the documented trade-off; on the card

### Outstanding questions (ASKED)
None.

### NITs not taken
- An options object for missedtell.markTold's why argument; one shape for both modules' markTold
- A dead stall mark left after a run until the next markTold (rejected by stillQuiet, harmless)
- The per-minute owed() result during a quiet stall (no write, no roster read; stated in the plan)
- A millisecond race between the tick's read and the mark's time

### Strengths
- The stall marks live on the task, so a restart no longer brings duplicate rows back (every round)
- Item 2 asks the missed-run tell's own naming rule, so no slot is told by both tells or by neither (rounds 5 to 8)
- Every new test has a control that can fail, and the key ones were mutation-checked (rounds 3 to 8)
