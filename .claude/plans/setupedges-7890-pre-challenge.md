---
pre_challenge: true
method: challenge-loop
branch: setupedges-7890
diff_hash: 10ebed1b2d2b5f8fdd8ea7a4c9d41484e0876e595e3e63becf4a36e91f16e9e1
validation: passed
subdir_audit: passed
timestamp: 2026-11-04T04:03:59Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (opus and sonnet alternating, one reviewer at a time)
**Converged:** No. Stopped at the standing 8-round review cap (Splinter 2026-10-22: past 8, continue only while a
BLOCKER is open). Round 8 raised no BLOCKER; its two warnings are recorded below and in the plan as known limits.
**Asked (awaiting user):** 0
**Self-generated:** not computed; every Origin is BRANCH by the fail-safe default. Rounds 1 and 3 each corrected a
design choice an earlier step of this branch made.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] the design contradicted itself: item 4 refuses a promote whose installer would stay older, but the
  unverified installer case promoted the app anyway --> FIXED (9d34703: an installer that cannot be checked is refused
  before any write; a head promote logs `setup_head=<commit>`)

#### Iteration 2
**Reviewer model:** sonnet
- findings fixed in ef04c31; a misplaced `#` comment in that fix swallowed a harness check (126 vs 127 ok) and was
  caught by comparing the ok count, then restored

#### Iteration 3
**Reviewer model:** opus
- [WARNING] the cannot-check refusal advised re-staging, which cannot replace setup-<v>.ps1 for a zip that names no
  commit --> FIXED (713b38e: the refusal names what works, a checkout of the commit staging named, or a new build)
- [WARNING] HEAD read more than once --> FIXED (713b38e: resolved to one commit, read and logged); a scratch-repo test
  proves the staging refusal

#### Iteration 4
**Reviewer model:** sonnet
- [WARNING] a HEAD git cannot resolve logged `setup_head=unknown` --> FIXED (ef6726e: refused)

#### Iteration 5
**Reviewer model:** opus
- [WARNING] the scratch repo lacked engine/ and HEAD's setup.ps1, so the test did not exercise the real path -->
  FIXED (37a85a9)

#### Iteration 6
**Reviewer model:** sonnet
- one small fix (9b53c36); the rest documented in the plan

#### Iteration 7
**Reviewer model:** opus
- [WARNING] the verification record's manifest check already blocks no-commit and dirty zips, so the head path is
  defence in depth, not a release path; docs said otherwise --> FIXED (8d1fdbe: plan, RELEASING.md, dirty NOTICE)

#### Iteration 8
**Reviewer model:** sonnet
- [NIT] RELEASING.md said "below" for text above --> FIXED (159d2a5)
- [WARNING] the staging witness commit is not recorded in the bucket --> DEFERRED: known limit in the plan; a new
  build always works
- [WARNING] setup_left is read before the write --> DEFERRED: it records what staging leaves live, which is that read
**Stopped** at the 8-round cap with no open BLOCKER.

### Validation
Full validation on 159d2a5c7a, run detached through detached-validate.sh: unit 26,877 tests, 0 failed; validation
PASSED (hash 10ebed1b2d2b), subdir audit clean. Focused harness tools/test-publish-r2-3725.sh: 129 ok, all passed.
Mutants that fail it, as they should: publish an unverified installer, drop the dirty notice, skip the staging blob
comparison.

### Strengths
- Nothing unverifiable is published: a mismatch or an unreadable HEAD refuses before any write.
- The staging hash is of the exact bytes read once, checked equal to `git hash-object`.
- Items 1 and 2 are named with their owners rather than half-built.
