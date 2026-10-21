---
pre_challenge: true
method: challenge-loop
branch: strandlinux-6667
diff_hash: 5b020dd9266eac9c7102e6283e19ec7f82156cb7de27c5c67d160389ff15529c
validation: passed-except-one-unrelated-load-flake
subdir_audit: passed
timestamp: 2026-10-20T14:58:53Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 blind rounds (opus, sonnet, opus, sonnet), converged at round 4, plus a 5th review (sonnet) of the
fixes from validation 1. Every finding and decision is in .claude/plans/strandlinux-6667.md.

**Validation, stated exactly.** Validation 1 (c401e814) failed 13 of 22348: 11 were this branch's (sed in a setup.sh
helper on the 4920 tests' minimal PATH; a 4920 test slice ended by this branch's helper; the CI-only live test not
declared manual), fixed in c1672b74; 2 were load (engine/remove.test.js, 104/104 alone). Validation 2 ran on
c1672b74, the code this proof covers, tree untouched throughout (DIRTY_AT_START 0, DIRTY_AT_END 0, HEAD_AFTER equal,
TREE_CLEAN_THROUGHOUT yes), AUDIT_RC 0, and failed ONE of 22348: server.community-read-soon-5636.test.js
"#5636 F4 ... the first ask waited for the whole read: 658 ms", a timing test. This branch touches neither that file
nor server.js. Run alone at load average 44 it passed 2 of 3 times (it failed once alone too), so it is a load flake
of an existing test, not this change. The PR's own CI runs the full suite again. diff_hash computed, never typed.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] the live test's control could go red if the timer fired in its window --> FIXED (timer held off)
- [WARNING] the uninstall helper was run by no test --> FIXED (stub systemctl, with and without)
- [NIT] new function sat under another function's comment --> FIXED
- [NIT] --no-block comment overstated; exit 1 scope overstated --> FIXED
- [NIT] bare systemctl, not $SYSTEMCTL --> FIXED
- [NIT] install note asked real systemd in a sandbox folder --> FIXED
- [NIT] the 4918 live test's cleanup left this home's timer --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] a sandboxed run reaches real systemd --> NOT CHANGED (premise false: engine/linuxboard.js:39 refuses only LAUNCH without SYSTEMD_DIR; the gate matches it)
- [WARNING] the first update to this release is not protected --> TRUE, recorded (not fixable in code)
- [NIT] wording and a long comment line --> FIXED

#### Iteration 3
**Reviewer model:** opus
- [WARNING] a timer left behind once its folder is gone failed every minute --> FIXED (ConditionPathExists on the binary and marker)
- [WARNING] no test of setup.sh's real install and uninstall --> FIXED (test-linux-setup-4920.yml asserts both)
- [NIT] wrong reason in round 2; removeBoard left the enable link; overstated comment --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
- No new issues found; three [NIT]s needing no change. Converged.

#### Iteration 5 (the validation-1 fixes)
**Reviewer model:** sonnet
- No blocker, no warning. [NIT] the new slice marker is a 4-line literal (fails loudly if reformatted) --> not changed
