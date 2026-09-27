---
pre_challenge: true
method: challenge-loop
branch: doorflight-4073
diff_hash: fb0659829902937be89c2926a61677559edc55dde12a6e30e015c27e62e370f5
validation: passed
subdir_audit: passed
timestamp: 2026-09-27T07:20:30Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 reviewer passes
**Converged:** Yes, at iteration 4 (its WARNING repeats the deferred margin premise; the rest NITs)
**Total findings:** 7 actionable (1 BLOCKER, 5 WARNINGs, 1 CONVENTION), plus NITs
**Fixed:** 6 | **Deferred:** 1 | **Asked (awaiting user):** 0

The final gate (6j) passed on this HEAD: validation and the subdir audit exit 0, and in that full run
under load the fixed test passed ("two callers asking for the shelf at once verify each door ONCE",
1236ms), the arm that was red in five of the author's full runs the evening before.

### Per-Iteration Breakdown

The Self-generated line is recorded as not measured: the 6c-bis blame lookup was not run, and this field
must not be filled in by judgement.

#### Iteration 1
**Reviewer model:** opus (default)
**New findings:** 1 BLOCKER, 2 WARNINGs, 2 NITs
**Self-generated:** not measured
- [BLOCKER] test 2 measured an absolute count that connect() already met (it reaches the verifier twice itself), so it proved nothing --> FIXED (a post-connect baseline, as test 1 has)
- [WARNING] the plan claimed test 2's wait fixed the race, with no proof arm for it --> FIXED (a state()-collapse mutation, red in 7s)
- [WARNING] the timeout message guessed "a slow machine" --> FIXED (it states what was seen)
- NITs taken: both load figures cited; the held reads settle in finally

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 1 CONVENTION, 1 NIT
**Self-generated:** not measured
- [CONVENTION] the 5s budget was spelled twice --> FIXED (VERIFY_WAIT_MS)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 2 WARNINGs, 3 NITs
**Self-generated:** not measured
- [WARNING] the forget() deadline timer was never cleared, so every passing run waited it out (about 6s, now 2s) --> FIXED
- [WARNING] the 300ms margin can miss a late second request under load --> DEFERRED (the plan's weakest premise: it errs toward passing, and the old 150ms sleep was strictly weaker)
- NITs taken: messages from the constant; the until() comment placed on until(); load history out of the code comment

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 new (its WARNING repeats iteration 3's deferral), 2 NITs
**Self-generated:** not measured
**Converged** -- no new actionable findings. It independently re-ran both mutation arms and got the documented reds.

### Proofs (each restored after)

- Sharing broken on the shelf: test 1 red, during = 2.
- A slow verifier: the new wait passes; the exact old 150ms shape fails test 1, as the flake did.
- The door's state() collapsed: test 2 red at the 5s deadline, "forget() waited on the shelf read already in flight"; before the deadline existed it hung until killed.
- Unmodified: 4/4 repeatedly; the file runs in about 2s.

### NITs (open)
- a raced-away forget() on the failure path is not in `pending` (it settles once the gate is released)
- `heldDoor()`'s closure `release` and its method `release()` share a name (pre-existing)
- five near-duplicate poll helpers across the test suite could be hoisted into test-support
