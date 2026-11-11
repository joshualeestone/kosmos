---
pre_challenge: true
method: challenge-loop
branch: daemondir-8404
diff_hash: fc87697c3d3b1453262088d0d37cf998d2b5e067f48cdf91a8f4f7f1b8552572
validation: passed (this Mac)
subdir_audit: passed
timestamp: 2026-11-11T23:55:47Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped at the fleet's review rule (a loop stops at 8 rounds unless a BLOCKER is open). No round ever raised a BLOCKER. Round 8 raised three NITs; two were fixed and one (round labels in comments) was kept, because the file already writes them that way.
**Total findings:** 0 BLOCKERs, 10 WARNINGs, 21 NITs, all fixed except the one NIT kept and one WARNING deferred with reasons (round 6, item 4: a kosmos runner's cleanup hook can end another runner of the same user; stated in the plan and for the operator on #8404, not changed here, because a guard would have root read a job-writable file).

**Validation, stated exactly.** Full suite on this Mac, at ce147f71b9 (rebased onto main 16:4x CST): hash fc87697c3d3b, 28520 node tests, 28067 pass, 0 fail, 0 cancelled. All four shell shards passed, and tools/test-ci-runner-daemon-7001.sh ran in shard 4. The build passed. Both runner suites (daemon-7001 and setup-4601) were also run by hand after every round.

**Mutations, each failing the suite:** the label built from REPO; the dir check dropped; the Worker match pinned to actions-runner; the symlink check dropped; the check limited to the named dir; the name requirement dropped; the dir check's empty-name arm dropped.

**What was not run:** nothing on a real runner Mac. The stage still needs root and a non-admin runner user on Mortals (mortalkombat is an admin, and the stage refuses that on purpose); the operator steps are on #8404.

### Per-Iteration Breakdown

#### Iteration 1 (opus)
- [WARNING] runner_busy half-moved to RUNNER_REPO while verify's row read used REPO --> FIXED (runner_busy back on REPO)
- [WARNING] daemon_xml's comment did not list the new inputs --> FIXED
- [NIT] no test of a second runner's Worker --> FIXED (two arms; the pinned-Worker mutant now fails)
- [NIT] install and create-user missing from the refusal loop --> FIXED
- [NIT] two repo spellings give one label --> FIXED (comment: the label is the identity)

#### Iteration 2 (sonnet)
- [WARNING] comment said keepalive "could" take the settings --> FIXED
- [NIT] keepalive's want_label half-converted --> FIXED (back on REPO)
- [NIT] repo case must match the registration URL --> FIXED (comment)

#### Iteration 3 (haiku)
- [WARNING] repo without dir told the operator to stop this repo's runner --> FIXED (both or neither)
- [WARNING] RUNNER_DIR checked as a string; a symlink passed --> FIXED (real directory required; mutant fails)
- [NIT] x5 (plan text, usage reason, comment wording, fixture runsvc path, leading '.') --> FIXED

#### Iteration 4 (opus)
- [WARNING] without the name, the stage advised an install the settings refuse --> FIXED (name required)
- [WARNING] comment said RUNNER_REPO reaches jq and gh --> FIXED
- [NIT] x4 (a test clause that could not fail, comment wording, unknown stage message, refusal order) --> FIXED

#### Iteration 5 (sonnet)
- [NIT] x3 (refusal wording, the default-dir behaviour change undocumented, machine-settings untested) --> FIXED
- Out of branch: the cleanup hook limit --> recorded in the plan

#### Iteration 6 (haiku)
- [WARNING] non-daemon stage told to set one more, then to unset --> FIXED (stage first)
- [WARNING] false reason for keepalive's refusal --> FIXED
- [WARNING] cleanup hook can end a second runner --> DEFERRED (see above)
- [NIT] x2 ("all three" wording; the FIFO window) --> FIXED

#### Iteration 7 (opus)
- [WARNING] unknown stage with some settings told to set one more --> FIXED (every stage but daemon refuses; no second stage list)
- [WARNING] the default-dir symlink claim untested --> FIXED (two arms; the named-dir-only mutant fails)
- [NIT] duplicated stage list --> FIXED by the same change

#### Iteration 8 (sonnet)
- [NIT] the empty-name arm untested --> FIXED ($CI_HOME// case; mutant fails)
- [NIT] dry-run wording of the dir refusal --> FIXED
- [NIT] round labels in comments --> KEPT (the file's own style)
