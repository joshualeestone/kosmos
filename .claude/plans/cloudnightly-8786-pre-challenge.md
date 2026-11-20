---
pre_challenge: true
method: challenge-loop
branch: cloudnightly-8786
diff_hash: b6b8039963cb404c0f9164463843342a5e88769b34ce6d0096f1f024009b17bf
validation: passed (Mortals, full suite, 01:25 CST 11-20 at b6d4fa5aee)
subdir_audit: passed
timestamp: 2026-11-20T07:30:33Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (round 4 raised nothing needing a change; its warnings were already-documented limits or deliberate trade-offs, recorded as deferred below)
**Total findings:** 30 (1 BLOCKER, 18 WARNINGs, 1 CONVENTION, 10 NITs)
**Fixed:** 19 | **Deferred:** 11 | **Asked (awaiting user):** 0

Note on 6.0: the full suite was not run as the baseline; the targeted tests ran locally and the full suite ran once at the end on Mortals (the fleet's rule: full suites only through the queues). That final run first went red on four repo guards (two test seams not excused, the raw-write ratchet, hand-built fixture rows, one leaked temp folder); all four were fixed in commit "the four repo guards the Mortals validation reddened" and the rerun passed.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above (nothing had committed in the loop yet)
- [WARNING] engine/linuxboard.js cloudUpdateUnitsFor - no KillMode, so a board the installer starts outside systemd dies with the run --> FIXED (KillMode=process)
- [WARNING] engine/linuxboard.js - setup.sh rewrites the board unit from the nightly unit's environment, losing the system tmux and beacon --> FIXED (carriedEnv shared by both units; board unit text byte-identical)
- [WARNING] engine/linuxboard.js - a refused nightly timer was reported to no one --> FIXED (setup.sh says so)
- [WARNING] engine/linuxboard.js - the hour's comment claimed local times true only outside DST --> FIXED (comment and plan)
- [WARNING] engine/linuxboard.cloudupdate-8786.test.js - setup.sh's name helper checked by regex, not run --> FIXED (helpers lifted and run)
- [NIT] no TimeoutStartSec --> FIXED (3h)
- [NIT] latch removed leaves the timer --> FIXED (installBoard removes stale units)
- [NIT] removeBoard error text named only the pause check --> FIXED
- [NIT] plan's channel premise omitted AGENT_WORKFORCE_UPDATE_CHANNEL --> FIXED (both names forced)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 5 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/cloudnightly.js - nothing guards the window after the second look --> FIXED (header states exactly what is guaranteed)
- [WARNING] engine/cloudnightly.js busyAgents - only 'working' counts; a stale 'working' skips forever --> DEFERRED: needs a real box's states (live measurement, recorded on the card)
- [WARNING] install/kosmos - a person's update during the wait could race --> FIXED (install.started rechecked after the wait)
- [WARNING] engine/linuxboard.js - an unreadable latch deleted a real Cloud box's timer --> FIXED (removed only on ENOENT)
- [WARNING] install/kosmos - the move to prod is one-way and unlogged --> FIXED (logged)
- [CONVENTION] "Settings" naming of the switch --> FIXED, and it exposed that the Updates switch was hidden on every Linux board: now shown on a Cloud board only, as the off switch
- [NIT] readStatus has no size cap --> DEFERRED: local trusted board
- [NIT] the real decide entry was untested --> FIXED (spawn test)
- [NIT] systemd-analyze verify not run --> DEFERRED: live measurement on the Cloud base image

#### Iteration 3
**Reviewer model:** opus (default)
**New findings:** 1 BLOCKER, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 2 of the above (the Cloud hint and the unreadable-setting sentence, both written in iteration 2's fix)
- [BLOCKER] web.win32-board-copy.test.js - two existing tests pinned the auto row's old markup --> FIXED
- [WARNING] web/index.html - the Cloud hint promised a manual path a Cloud computer does not have --> FIXED (claim deleted: "it stops updating itself")
- [WARNING] web/index.html autoPaint - an unreadable setting on Cloud named an Install button --> FIXED
- [WARNING] install/setup.sh - the uninstall did not stop a nightly run in flight --> FIXED (stopped unless running inside it)
- [NIT] removeBoard comment implied an update path --> FIXED
- [NIT] a failed night leaves the unit failed --> DEFERRED: a real signal, kept
- [NIT] real Linux seams untested end to end --> DEFERRED: live measurement

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 2 NITs (none needing a change)
**Self-generated:** 0 of the above
- [WARNING] the nightly line logs only the last line of the update --> DEFERRED: the reason is in install.log
- [WARNING] a latch replaced by a symlink leaves the timer --> DEFERRED: the safe direction, decide() skips quietly
- [WARNING] a failed night leaves the unit failed --> DEFERRED (duplicate of iteration 3's NIT)
- [WARNING] the busy check covers only the two looks --> DEFERRED (duplicate of iteration 2, already stated in the header)
- [NIT] test seams exported from production code --> DEFERRED: the repo's convention
- [NIT] nested _cloud_log is global in bash --> DEFERRED: harmless
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/linuxboard.js | BRANCH | no KillMode on the nightly service | FIXED | iteration 1 commit |
| 2 | 1 | WARNING | engine/linuxboard.js | BRANCH | board unit rewritten without carried env | FIXED | iteration 1 commit |
| 3 | 1 | WARNING | engine/linuxboard.js | BRANCH | refused timer reported to no one | FIXED | iteration 1 commit |
| 4 | 1 | WARNING | engine/linuxboard.js | BRANCH | DST-dependent local times in a comment | FIXED | iteration 1 commit |
| 5 | 1 | WARNING | engine/linuxboard.cloudupdate-8786.test.js | BRANCH | shell helper not run | FIXED | iteration 1 commit |
| 6 | 2 | WARNING | engine/cloudnightly.js | BRANCH | window after the second look | FIXED | iteration 2 commit |
| 7 | 2 | WARNING | engine/cloudnightly.js | BRANCH | busy means only 'working' | DEFERRED | live measurement |
| 8 | 2 | WARNING | install/kosmos | BRANCH | race with a person's update during the wait | FIXED | iteration 2 commit |
| 9 | 2 | WARNING | engine/linuxboard.js | SELF | unreadable latch deletes the timer | FIXED | iteration 2 commit |
| 10 | 2 | WARNING | install/kosmos | BRANCH | move to prod unlogged | FIXED | iteration 2 commit |
| 11 | 2 | CONVENTION | web/index.html | BRANCH | the off switch was hidden on Linux | FIXED | iteration 2 commit |
| 12 | 3 | BLOCKER | web.win32-board-copy.test.js | BRANCH | stale markup pins | FIXED | iteration 3 commit |
| 13 | 3 | WARNING | web/index.html | SELF | Cloud hint promised a manual path | FIXED | claim deleted |
| 14 | 3 | WARNING | web/index.html | SELF | unreadable sentence named Install | FIXED | iteration 3 commit |
| 15 | 3 | WARNING | install/setup.sh | BRANCH | uninstall races a nightly run | FIXED | iteration 3 commit |

### NITs (non-blocking, across all iterations)
- readStatus has no size cap (iteration 2)
- a failed night leaves the systemd unit failed (iterations 3 and 4)
- test seams exported from production code (iteration 4)
- nested _cloud_log is global in bash (iteration 4)

### Strengths (across all iterations)
- decide() is pure, every seam injectable, and fails toward skipping (iterations 1 to 4)
- the run reuses cmd_update, so the fleet pause, the signed run-setup, the consent, install.started and the agent refusal come with it (iteration 1)
- carriedEnv keeps the board unit and the nightly unit from drifting, with the board text byte-identical (iterations 3 and 4)
- every gate test has a control that can fail (iterations 1 and 4)
