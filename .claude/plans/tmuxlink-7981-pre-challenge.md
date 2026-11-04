---
pre_challenge: true
method: challenge-loop
branch: tmuxlink-7981
diff_hash: df2ff7ec28635a59b4c15b37f95408e46092258d5d88399865829b8291c951b9
validation: partial (scanning guards, the new test under sh and dash, and the 518 tests that read install/setup.sh; the full suite is left to CI, not run locally)
subdir_audit: not run (no subdir CLAUDE.md in the diff)
timestamp: 2026-11-04T22:05:23Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes, on iteration 6: no new BLOCKER, WARNING or CONVENTION.
**Total findings:** 0 BLOCKERs, 12 WARNINGs, 1 CONVENTION, 13 NITs
**Fixed:** most WARNINGs | **Deferred:** listed below | **Asked (awaiting user):** 0

**The fix changed shape in review.** Iterations 1 to 3 hardened a version that filtered PATH by physical folder. Iteration 3 showed it could not see a link one hop away, could run apt-get, and could swap tmux under running agents. It was replaced by one `-ef` test, six lines against main.

Measured:
- tools/test-setup-linux-tmux-7981.sh: 17 arms, under the Mac's sh and with sh as dash.
- Before any fix it failed with the card's exact error, so the mechanism is reproduced, not only read.
- Removing the `-ef` test fails 7 arms. Replacing it with "keep any working link" fails the different-tmux arm.

Not measured: the whole path on a Linux board with this fix, since the served installer is what a board runs. The release check named in the plan is the real gate: a 0.7.89 board updates to 0.7.90 and comes back up.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] install/setup.sh: other spellings of the folder reproduced the failure --> FIXED (9640b5aa0e), then superseded by `-ef`
- [WARNING] test: the look after apt-get had no arm --> FIXED
- [WARNING] test: no arm for spellings --> FIXED
- [WARNING] plan: the premise holds only for the tmux step --> DEFERRED: the release check is the gate, and the plan says so

#### Iteration 2
**Reviewer model:** sonnet, whole-branch, no plan file
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above
- [WARNING] CDPATH could change what cd prints --> FIXED (62ea901845), then superseded by `-ef`

#### Iteration 3
**Reviewer model:** opus, whole-branch, no plan file
**New findings:** 0 BLOCKERs, 6 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 3 of the above
- [WARNING] a working link off PATH, and apt-get swapping tmux under agents --> FIXED by `-ef` (ca95437606), with the login-shell limit named in the plan
- [WARNING] no fresh-install arm under set -eu --> FIXED
- [WARNING] a link one hop away still destroyed the link --> FIXED by `-ef`
- [WARNING] unguarded defensive lines --> FIXED: the lines are gone

#### Iteration 4
**Reviewer model:** sonnet, whole-branch, no plan file
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above
- [WARNING] the link stays put from the CLI --> DEFERRED: on purpose, a different tmux breaks live servers; recorded in the plan

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 1 NIT (1 further WARNING was the plan's stated gap)
**Self-generated:** 2 of the above
- [WARNING] test: no different live tmux, and the comment named another case --> FIXED (c96065d1cc history)
- [WARNING] test: the two commonest updates had no arm --> FIXED
- [CONVENTION] plan name has no timestamp --> DEFERRED: nothing enforces it and the gate finds it by branch

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
**Converged:** no new actionable findings.

### Outstanding questions (ASKED)
None.

### NITs
- The kept path's sentence names the link, not what it resolves to. The test file is mode 644, like 34 of its siblings.

### Strengths
- `-ef` is already used elsewhere in this installer, and asks the question directly instead of normalising paths.
