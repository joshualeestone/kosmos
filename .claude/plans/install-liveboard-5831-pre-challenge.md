---
pre_challenge: true
method: challenge-loop
branch: install-liveboard-5831
diff_hash: 061e53ad582ee43b3b0af5e50b2be740159a7b5ae8d112caa50edbbb1ac15d7d
validation: passed
subdir_audit: passed
timestamp: 2026-10-11T14:02:39Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

Six fresh blind reviewers, alternating opus and sonnet, none told what an earlier round had found.

**Iterations:** 6
**Converged:** Yes, at iteration 6
**Total findings:** 20 (1 BLOCKER, 12 WARNINGs, 4 CONVENTIONs, 3 NITs)
**Fixed:** 15 | **Deferred:** 5 | **Asked (awaiting user):** 0

**The review ran before a rebase; the validation ran after it.** The six rounds reviewed the branch up to
774041525. Main then took #4476, which also changes `tools/test-install.sh` (the harness now installs with a
read-only app folder). The branch was rebased onto that main with no conflict and no hand edits; the diff
against main is the same two files and the same 198 added and 20 removed lines. Everything below was measured at
the rebased head, 9b01f1a3c.

**Validation at 9b01f1a3c:**
- **Full `tools/test-install.sh`, every leg, on Mortals with the live board up:** 407 passed, 0 failed. The #924
  default-home control passes, the three #5831 checks pass, and the closing check "the real com.kosmos.board job
  is the same process as when this run began" passes. Read independently of the harness, the live board was pid
  86289, started Sun Oct 11 07:38:13 2026, before and after.
- **Full suite through the validation helper, in the fair queue:** exit 0. 19,091 tests, 18,847 pass, 0 fail, 244 skipped, every shell check green. Logged PASSED for diff hash 061e53ad582e.
- **One suite run at this head was red and the cause was the runner, not the code.** The script that ran the
  install test exported `KOSMOS_ALLOW_MINOS=1` (needed only by the bundle builds) and the suite inherited it.
  With it, `tools/test-floor-gate-tree.sh` reports "the walk certified a stage holding a minos 27.0 binary nested
  under app/bin". That file alone at this head: exit 0 without the variable, exit 1 with it. The rerun does not
  carry it. This branch does not touch that check.
- Earlier, before the rebase: full test-install 398 passed and 0 failed at 35ab3d540, 400 and 0 at 345ae559b,
  and a green full suite at 774041525 (18,997 tests, 0 fail). Those heads are not ancestors of this one.
- Subdir CLAUDE.md audit: passed.

**Can the new closing check fail?** Shown with the harness's own `chk` line through `eval`: the true value
passes, an old pid (21886) fails, and an empty "before" against a running board fails. It was not shown by
restarting the live board again; the one real restart is on record from before the check existed (the card).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 2 WARNINGs, 1 CONVENTION, 0 NITs
**Self-generated:** 0 of the above
- [BLOCKER] tools/test-install.sh (#924 control, the stop after the install): `kosmos stop` read the previous scenario's exported `KOSMOS_HOME`, stopped nothing, and the port was then freed by force after 15 seconds --> FIXED (033c50269): `env -u KOSMOS_HOME` on that stop
- [WARNING] tools/test-install.sh (closing check): "nothing running before, something running after" was skipped, so a start under the real label went unseen --> FIXED (033c50269): the comparison always runs
- [WARNING] plan: "the check can fail" was shown by hand only --> FIXED (033c50269): demonstrated with the harness's own `chk` line, three arms
- [CONVENTION] tools/test-install.sh: the gate test was spelled differently from the file's others --> FIXED (033c50269)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings (confirmed resolved):** 1
- [WARNING] tools/test-install.sh: four sibling default-home stops (`$SBH_DEF`, `$SBH_SLASH/`, `$D918_HOME_D` twice) had the same wrong-home fault --> FIXED (08b75c58d): each names its own home
- [WARNING] tools/test-install.sh (closing check): green when this shell cannot read the launchd domain at all --> FIXED (08b75c58d): `LIVE_BOARD_SEEN`, and the check says so
- [WARNING] tools/test-install.sh (#924 control): the half-sandbox override is safe only while two exports hold, and nothing checked them --> FIXED (08b75c58d): a check on both

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 2 CONVENTIONs, 0 NITs
**Self-generated:** 2 of the above (the precondition check and the skip path were added by the loop)
- [WARNING] tools/test-install.sh (#924 control): the precondition check reported but did not gate: the install still ran with the override --> FIXED (06c4f79a0): the override's value is the check's own result, so a 0 leaves the guard on and the install is refused
- [WARNING] tools/test-install.sh (closing check): the unseen-launchd path printed a note but was counted nowhere --> FIXED (06c4f79a0): it counts as a SKIP
- [CONVENTION] tools/test-install.sh: comments carried a dated incident narrative --> FIXED (06c4f79a0): trimmed to what the code needs; the story is on the card
- [CONVENTION] tools/test-install.sh: an orphan comment line --> FIXED (06c4f79a0)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** 1 of the above
- [WARNING] tools/test-install.sh (#924 control): "the defaults resolve inside the sandbox" was asserted, not traced --> FIXED (30eda148a): the comment names the files that decide it, and a new check requires the control's `board.pid` under the fake home
- [WARNING] tools/test-install.sh (closing check): a FAIL could also mean the shell lost sight of launchd by the end, and the text did not say so --> FIXED (30eda148a)
- [WARNING] tools/test-install.sh: an `&&` list whose status could leak under `set -e` --> FIXED (30eda148a): an `if`

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 0 NITs
**Self-generated:** 1 of the above (a comment the loop wrote)
- [WARNING] tools/test-install.sh (#924 control): the control board's store sits under `$SB/home`, not the fake home --> DEFERRED: read and not a leak; `$SB/home` is inside this run's sandbox and is deleted with it, and moving it changes what the leg tests
- [WARNING] tools/test-install.sh (closing check): it watches the board job only, not the watchdog job --> DEFERRED: beyond the card, which asks for the board pid; noted on #5831 as a follow-up
- [CONVENTION] tools/test-install.sh: comments: name `projects.js`, say why at the first default-home stop, rewrap --> FIXED (9b01f1a3c, comments only)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [NIT] tools/test-install.sh: one comment wraps with an orphan line --> DEFERRED: cosmetic
- [NIT] tools/test-install.sh (`live_board_id`): "the service's own" pid line could say "the first such line" --> DEFERRED: wording
- [NIT] tools/test-install.sh: `-s board.pid` proves a file was written, not that the pid in it is alive --> DEFERRED: the install's exit 0 and the stop that follows cover liveness

### Convergence

Iteration 6 returned no BLOCKER, WARNING or CONVENTION, new or repeated. Two models witnessed it: the last opus
round (5) found comment fixes and two deferrals, the last sonnet round (6) found NITs only.
