---
pre_challenge: true
method: challenge-loop
branch: app-readonly-4449
diff_hash: 69fccaff4dc42209166173081d16924802a9c60053bba6644f061ed38ebe414f
validation: passed
subdir_audit: passed
timestamp: 2026-10-11T09:59:06Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

This replaces the proof of 2026-09-29, which certified the branch on a base 3,417 commits old. The branch was
re-applied on current main on 2026-10-11 and reviewed again from nothing: four fresh blind reviewers, none told
what the earlier loop or the earlier rounds had found.

**Iterations:** 4
**Converged:** Yes, at iteration 4
**Total findings:** 12 (2 BLOCKERs, 8 WARNINGs, 1 CONVENTION, 1 NIT)
**Fixed:** 8 | **Deferred:** 4 | **Asked (awaiting user):** 0

**Validation at 73d270813 (the reviewed head):**
- Full suite through the validation helper, in the fair queue: exit 0. 18,953 tests, 18,709 pass, 0 fail,
  244 skipped, and every shell check green. Logged PASSED for diff hash 69fccaff4dc4.
- **An earlier run of the same head was red on one shell check**, `tools/test-floor-gate-tree.sh` ("the walk
  certified a stage holding a minos 27.0 binary nested under app/bin"), with the node tests at the same 18,709
  and 0. That check is green alone 3 of 3 and green in the rerun, and this branch does not touch it. Both logs
  are kept; Liu Kang asked for a clean rerun to settle it (m4954).
- `tools/test-install.sh` **with one leg skipped**: 400 passed, 0 failed, all seven #4449 checks and their
  control pass. The skipped leg is the #924 default-home control, which on main starts under the real
  `com.kosmos.board` label and restarts the live board (kosmos#5831; it did so once, at 08:50Z, in the first
  full run, which ended 403 passed and 1 failed, the 1 being that leg). The skip was made in a throwaway copy
  at the same head and is not in this branch. The live board was the same process before and after.
- Subdir CLAUDE.md audit: passed.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 4 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0 of the above (nothing had been committed by the loop yet)
- [BLOCKER] tools/test-install.sh (#4382 fixture `_older`) — the fixture rewrites `app/package.json` in the sandbox install; with this harness's `KOSMOS_READONLY_APP=1` the write is refused and `set -e` ends the run with no tally --> FIXED (377b5313f): the fixture lifts the lock for its own edit
- [WARNING] install/setup.sh, tools/test-install.sh, engine/defaults.js — comments say the app "is read-only" where the switch is off by default --> FIXED (377b5313f): "may be read-only"
- [WARNING] install/setup.sh (lock step) — a failed `chmod -R a-w` was silent --> FIXED (377b5313f): prints a note
- [WARNING] eight other sandbox harnesses drive install/setup.sh and edit or delete the sandbox install --> DEFERRED: unreachable while the switch is off; recorded on #4455 as a condition for turning it on
- [WARNING] the "nothing writes under app/ at runtime" measurement is 12 days old --> DEFERRED: does not gate this PR (read-only is off); recorded on #4455

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 0 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings (confirmed resolved):** 2
- [WARNING] tools/test-install.sh — nothing pinned that only `app/` is locked --> FIXED (50aeb0cb3): new check "#4449: bin/ and runtime/ are left writable"
- [WARNING] install/setup.sh (pre-swap lift) — the lift tolerates a failed chmod, after which `rm -rf` can fail part way --> DEFERRED: with the switch off the tree was never locked, so the swap behaves as on main; recorded on #4455 with the fix it needs
- [WARNING] tools/test-install.sh — "the `[ ! -w ]` checks pass trivially as root" --> DEFERRED: read and not an issue; `-w` is true for root, so `! -w` is false and the check goes red
- [CONVENTION] the proof file is committed --> DEFERRED: it is committed by this repo's convention

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above (the cited lines came from the re-apply commit, not from a loop fix)
**Duplicates of prior findings (confirmed resolved):** 3
- [BLOCKER] install/setup.sh (swap loop) vs engine/status.test.js (#2955) — the test lifts the swap loop by pattern and allows only whitespace between `do` and `rm -rf`; the lift sat in that gap, so the test was red --> FIXED (73d270813): the lift is its own pass before the loop; checked that the pattern matches this head and not the previous one
- [WARNING] install/setup.sh (`chmod -R u+w "$stage"`) — no test would notice the line being removed --> FIXED (73d270813): the update leg installs from a read-only source copy, with a control that the copy is read-only
- [NIT] install/setup.sh — `KOSMOS_READONLY_APP` not named beside the other knobs --> FIXED (73d270813)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0 of the above
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | tools/test-install.sh (#4382 fixture) | BRANCH | fixture writes into a read-only app, run dies with no tally | FIXED | 377b5313f |
| 2 | 1 | WARNING | install/setup.sh and others (comments) | BRANCH | "is read-only" where it is off by default | FIXED | 377b5313f |
| 3 | 1 | WARNING | install/setup.sh (lock step) | BRANCH | failed lock was silent | FIXED | 377b5313f |
| 4 | 1 | WARNING | eight other harnesses | BRANCH | need the lift once read-only is on | DEFERRED | #4455 condition 2 |
| 5 | 1 | WARNING | PR text | BRANCH | runtime-writer measurement is stale | DEFERRED | #4455 condition 1 |
| 6 | 2 | WARNING | tools/test-install.sh | BRANCH | only-app-is-locked was unpinned | FIXED | 50aeb0cb3 |
| 7 | 2 | WARNING | install/setup.sh (lift) | BRANCH | lift tolerates a failed chmod | DEFERRED | #4455 condition 3 |
| 8 | 2 | WARNING | tools/test-install.sh | BRANCH | `[ ! -w ]` said to pass as root | DEFERRED | not an issue: it reds as root |
| 9 | 2 | CONVENTION | .claude/plans | BRANCH | proof file committed | DEFERRED | repo convention |
| 10 | 3 | BLOCKER | install/setup.sh (swap loop) | BRANCH | lift inside the loop broke a lifted-text test | FIXED | 73d270813 |
| 11 | 3 | WARNING | install/setup.sh (stage chmod) | BRANCH | line had no test | FIXED | 73d270813 |
| 12 | 3 | NIT | install/setup.sh | BRANCH | knob undocumented | FIXED | 73d270813 |

### Outstanding questions (ASKED, still unresolved when the run ended)
None from the loop. Separately, a read of the installer hunks was asked of Baron on the card (#4449) once; with
no answer, Liu Kang does that read (m4951).

### NITs (non-blocking, across all iterations)
- [NIT] install/setup.sh — `KOSMOS_READONLY_APP` not named beside the other knobs (iteration 3, fixed)

### Strengths (across all iterations)
- Read-only is off by default, so the lift ships a release ahead of the lock (iterations 1 and 2)
- Each lock and lift has a check that goes red when the line is removed (iterations 3 and 4)
