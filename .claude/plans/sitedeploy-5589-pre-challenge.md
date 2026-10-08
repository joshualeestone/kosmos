---
pre_challenge: true
method: challenge-loop
branch: sitedeploy-5589
diff_hash: f2f04a4329466744dd78547bf1c92a4e5de1bae1e837903998378d8a88f463f2
validation: passed (Mortals, entry clean, 16834 tests, 0 fail)
subdir_audit: passed
timestamp: 2026-10-08T14:56:05Z
iterations: 16
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 16
**Converged:** Yes (iteration 16 returned only findings already in the ledger: deduplicated, none new)
**Total findings:** 46 actionable (1 BLOCKER, 41 WARNINGs, 4 CONVENTIONs), counted from the breakdown below (iteration 14's and 16's duplicates not counted), plus NITs
**Fixed:** 38 | **Deferred:** 8 (the ledger below; each measured, read in code, or a duplicate) | **Asked (awaiting user):** 0
**Validation:** the full suite on Mortals for this exact diff hash: entry status clean, 16834 tests, 0 fail; both of this branch's test files ran (test-site-autodeploy-5589.sh ALL PASS, test-deploy-site-promote.sh ALL PASS). Main moved 40 commits since, touching none of this branch's files and adding no test that reads deploy-site.sh. The targeted tests (12 deploy-site, staging and served-verify test files) ran green after every round, and every new guard was red-checked by reverting it.
**Reviewer models:** opus (iterations 1, 3, 5, 7, 9, 11, 13, 15), sonnet (2, 4, 6, 8, 10, 12, 14, 16).
**Self-generated:** counted per round below; several rounds' findings were in the previous round's own fixes (the comments and the new behaviour), as the loop expects.

### Per-Iteration Breakdown
The full per-round detail, finding by finding, is in each commit message "sitedeploy-5589 -- address challenge-loop iteration N findings" on this branch (git log). Summary:

#### Iteration 1 (opus)
**New findings:** 0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, 5 NITs. **Self-generated:** 0
- [WARNING] tools/deploy-site.sh: snapshot taken after check_staging_not_stale, so a cut landing between them is missed --> FIXED (snapshot moved before every start-of-run comparison)
- [WARNING] tools/deploy-site.sh: an unreadable pointer at the start is only noticed at the end --> FIXED (refuse at once)
- [WARNING] tools/test-deploy-site-promote.sh: the 000 arms untested --> FIXED (cases 30, 31)
- [WARNING] tools/site-autodeploy.sh: everything went only to the log, a red run showed nothing --> FIXED (stdout too, tested)
- [WARNING] tools/site-autodeploy.sh: aborted cut between 7b and 8 --> FIXED later as a rule (iteration 11); documented here
- [NIT] lock races, cut detection is this-machine only, clone --dissociate, log growth, dirty-file scope

#### Iteration 2 (sonnet)
**New findings:** 3 WARNINGs. **Self-generated:** 1
- [WARNING] a benign pointer change parked a website change --> FIXED (exit 75, retried)
- [WARNING] a varying 404 body would read as a moved pointer --> FIXED (only 200 bodies compared; case 29)
- [WARNING] cut started with shell options not seen --> FIXED (regex allows options; tested)

#### Iteration 3 (opus)
**New findings:** 4 WARNINGs, 1 CONVENTION. **Self-generated:** 2
- [WARNING] KOSMOS_REPO not set: deploy-site.sh would load libraries from the cut's checkout --> FIXED (tested)
- [WARNING] negative-control blip and latest.json read exited 1 --> FIXED (75; cases 32, 33)
- [WARNING] exit 75 never escalated --> FIXED (red alarm)
- [WARNING] heartbeat written before the lock --> FIXED
- [CONVENTION] plan said "right after check_staging_not_stale" --> FIXED

#### Iteration 4 (sonnet)
**New findings:** 3 WARNINGs. **Self-generated:** 1
- [WARNING] retry count trusted unchecked text --> FIXED (numeric guard; a planted $(...) never runs, tested)
- [WARNING] pointer guard narrows, does not close, the race --> FIXED in the plan (stated; post-deploy failure beside a cut is a rollback)
- [WARNING] launch shapes the cut match misses --> FIXED (documented)

#### Iteration 5 (opus)
**New findings:** 3 WARNINGs. **Self-generated:** 0
- [WARNING] the job's own clone has no older versioned tarballs, so every auto deploy would take them off the site --> FIXED (mirror from the cut checkout, removals included; tested)
- [WARNING] other transport reads still exit 1 and would park --> FIXED (retry once, then park)
- [WARNING] redeploy after every cut --> FIXED (skip a commit the served .kosmos-release-export already names; measured live)

#### Iteration 6 (sonnet)
**New findings:** 2 WARNINGs. **Self-generated:** 1
- [WARNING] main briefly behind live after a cut --> DEFERRED: release.sh step 7b pushes before step 8 deploys (read in release.sh), so main never lags live after a cut
- [WARNING] a half-written older tarball could be mirrored --> FIXED (each mirrored tarball must match its .sha256)
- (an `if !` rewrite I made read $? as 0; caught by case 32 before commit, fixed; case 32b added for the other arm)

#### Iteration 7 (opus)
**New findings:** 1 BLOCKER, 2 WARNINGs, 1 CONVENTION. **Self-generated:** 0
- [BLOCKER] `ps | grep -q` under pipefail: SIGPIPE on a real process list reads a running cut as none --> FIXED (capture, then match; 220 KB list test, red with the pipeline)
- [WARNING] a mismatch that never clears stays green --> FIXED (alarm)
- [WARNING] .kosmos-release-export never read from live before --> DEFERRED: measured live at 07:13 (200, commit=fa7a0596)
- [CONVENTION] plan said red once for the aborted-cut path --> FIXED

#### Iteration 8 (sonnet)
**New findings:** 3 WARNINGs. **Self-generated:** 2
- [WARNING] heartbeat could read wedged during a long deploy --> FIXED (refreshed before the deploy)
- [WARNING] a cut starting mid-mirror --> FIXED (second publisher check after the mirror; tested)
- [WARNING] residual race --> DEFERRED: duplicate of iteration 4's documented residual

#### Iteration 9 (opus)
**New findings:** 2 WARNINGs, 1 CONVENTION. **Self-generated:** 1
- [WARNING] an empty or rebuilt cut dist/ would be mirrored with --delete --> FIXED (floor: none, or far fewer than the last good mirror, parks; tested)
- [WARNING] alarms fire once then green --> FIXED (red every tick from the 4th)
- [CONVENTION] plan item 2 contradicted retry-once --> FIXED
- NITs: 5xx through every retry now unread (case 34), MISMATCH initialised, parked tick says so, test lock-holder trap, case names

#### Iteration 10 (sonnet)
**New findings:** 3 WARNINGs. **Self-generated:** 0
- [WARNING] marker vs pointers --> DEFERRED: a mismatch only costs a redundant deploy behind deploy-site.sh's guards (in the plan)
- [WARNING] a flapping 404 --> DEFERRED: reviewer's own verdict "acceptable": retried, red from the 4th tick
- [WARNING] permanent 4xx on latest.json retried forever --> DEFERRED: this morning's 07:40 outage was exactly an HTTP 403 that cleared in minutes; red from the 4th tick keeps a real one loud
(converged here; then a post-convergence comment change, so iteration 11 ran)

#### Iteration 11 (opus)
**New findings:** 4 WARNINGs, 1 CONVENTION. **Self-generated:** 1
- [WARNING] a deploy that failed after publishing was cleared by "already live" --> FIXED (tested)
- [WARNING] an aborted cut's unchecked staging build could be published through the mirror --> FIXED (a website deploy never publishes a release pointer; Windows pointers serve from R2 and are skipped; tested)
- [WARNING] live going back to an older commit of main not noticed --> FIXED (redeploy on a strict-ancestor marker; tested with an unrelated-marker control)
- [WARNING] most deploy-site.sh fetch failures still exit 1 --> DEFERRED: retry-once covers one blip; making every fetch path transient is wider than this card (in the plan)
- [CONVENTION] mirror-count undocumented --> FIXED

#### Iteration 12 (sonnet)
**New findings:** 2 WARNINGs. **Self-generated:** 1
- [WARNING] the mirror floor trips on a real big prune --> FIXED (documented as intended, with the recovery)
- [WARNING] Windows pointers through R2 might not be byte-stable --> DEFERRED: measured stable (three reads from Agent1s, one from Mortals, identical)

#### Iteration 13 (opus)
**New findings:** 3 WARNINGs. **Self-generated:** 2
- [WARNING] a parked sha went green after one red run --> FIXED (red every tick)
- [WARNING] an unreleased build at the cut box could be mirrored and served at its versioned URL --> FIXED (ceiling: newest release pointer on main; tested)
- [WARNING] a deliberate site rollback would be undone with no way to pause --> FIXED (`paused` file; tested)
- (bash 3.2: an empty array under set -u is unbound; every tick died; caught by the suite before commit)
- NIT deferred: clear a park when live serves main (our own failed post-deploy publish also serves main)

#### Iteration 14 (sonnet)
**New findings:** 1 WARNING (+2 duplicates). **Self-generated:** 0
- [WARNING] the pointer comparison did not follow redirects --> FIXED (-L, as deploy-site.sh)
- duplicates: residual race (it.4), exit-code callers (it.4)

#### Iteration 15 (opus)
**New findings:** 1 WARNING. **Self-generated:** 1
- [WARNING] a promote pushes its pointer then deploys, so a tick between parks it and it stays red --> FIXED (retried, not parked; clears itself once live catches up; tested)

#### Iteration 16 (sonnet)
**New findings:** 0 (3 warnings, all duplicates: residual race it.4/8/14, exit-code callers it.4/14, unreachable-host cost it.15)
**Converged** - no new actionable findings.

### Final Ledger (deferred entries; every other actionable finding is FIXED in the commit named "iteration N")

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 6 | WARNING | tools/site-autodeploy.sh | BRANCH | main lags live after a cut | DEFERRED | 7b pushes before 8 |
| 2 | 7 | WARNING | tools/site-autodeploy.sh | SELF | served marker never read before | DEFERRED | measured live 07:13 |
| 3 | 8 | WARNING | tools/site-autodeploy.sh | BRANCH | residual race | DEFERRED | dup of it.4, documented |
| 4 | 10 | WARNING | tools/site-autodeploy.sh | SELF | marker vs pointers | DEFERRED | redundant deploy only |
| 5 | 10 | WARNING | tools/deploy-site.sh | SELF | flapping 404 | DEFERRED | retried, red from 4th |
| 6 | 10 | WARNING | tools/deploy-site.sh | SELF | permanent 4xx retried | DEFERRED | 07:40 403 was transient |
| 7 | 11 | WARNING | tools/deploy-site.sh | BRANCH | fetch paths exit 1 | DEFERRED | wider than this card |
| 8 | 12 | WARNING | tools/deploy-site.sh | SELF | R2 pointer stability | DEFERRED | measured stable |

### NITs (non-blocking)
- the cut match misses `bash -o pipefail ...` and paths with spaces (documented); the file:// branch is test-only; the snapshot can add minutes on a host timing out on everything (documented); package.json's test:shell line is long (existing style).

### Strengths
- Every new guard has a test that goes red when the guard is reverted (checked each round), plus a control that must stay green.
- The design keeps every existing deploy-site.sh guard and only adds; the plan states what it does not cover.
