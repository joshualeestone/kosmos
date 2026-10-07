---
pre_challenge: true
method: challenge-loop
branch: sandboxpause-4651
diff_hash: 462bdfcba3b8933728074455ea5c0480296f296592e671047b1b8538c736846e
validation: passed (PR #5462's GitHub CI at b0dc99707, the rebased head this proof covers, all six jobs SUCCESS: suite (node), suite (shell 1/2), suite (shell 2/2), test, test-linux-setup, windows. Earlier, Mortals full suite at 77e1827bf before the rebase onto #5067's merge: 0 failures. On the rebased tree by hand: test-setup-pause-sandbox-4651 0 failures, test-update-putback-4818 33/33, test-pause-foreign-board-964 12/12, test-update-abort-2055 10/10, test-install-static 23/23)
subdir_audit: passed
timestamp: 2026-10-07T14:09:00Z
iterations: 16
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 16 (5 by Sonya Blade before the rebase, 11 by Baron Draxum after it)
**Converged:** Yes (pass 11 after the rebase found no new BLOCKER, WARNING or CONVENTION)
**Fixed:** every actionable finding, each in a commit that names its pass | **Deferred:** see below | **Asked:** 0

**Rebased onto main after #5067 merged** (3ec876aa3): the diff is this card's own files only (install/setup.sh,
tools/test-setup-pause-sandbox-4651.sh, package.json's test:shell line, the plan; one package.json conflict resolved as a
union with main's 4592 script). This proof was regenerated for that diff.

### Per-Iteration Breakdown

Iterations 1 to 5 (Sonya Blade, 2026-09-30, reviewer model not recorded): the fail-closed pause, its two seatbelt-profile
test, and five rounds of fixes (6fa6db638, 73bc29b81, 72646d88e, afe2205f5, 7ba0fd146).

After the rebase onto main (2026-10-06, Baron Draxum; models alternated opus and sonnet). The rebase met main's newer
#4818 put-back, whose failure line ("Kosmos was paused for this update and could not be started again") the stops after a
failed port check cannot know is true. Each pass's findings and fix are in its commit message:

#### Pass 1: a9d860abe
**Self-generated:** 0
- [WARNING] put-back after a blind stop claims a pause that may not have happened --> first design: hand the board back to launchd (later rejected)
#### Pass 2: e64ca66f6, 1d124076a
- [WARNING] the "will start again by itself" note is false in a sandbox --> removed; state arms for every blocked-shell stop
#### Pass 3: 80131ebf0
- [WARNING] keying the hand-back on the marker is unreliable (an installed kosmos older than #4636 writes it without stopping) --> neither way claimed
#### Pass 4: bd1e66fc4
- [WARNING] app advice ambiguous --> anchored, only for a board this run meant to run; person-stopped and first-stop arms added
#### Pass 5: 7926b4149
- [CONVENTION] comment and plan did not match behaviour --> fixed; advice asserted present and absent per arm
#### Pass 6: 36b198480
- [CONVENTION] main's #5033 comments --> name the hand-back; "Kosmos itself" beside another app's pid
#### Pass 7: 771547c42
- [BLOCKER] disarming the put-back left an unsupervised board off after an unread automatic update --> FINAL design: keep main's put-back; after a failed port check only its failure words change (_kosmos_putback_unsure)
#### Pass 8: ad75371b0
- [WARNING] an unsure put-back that starts said "running again" --> "Kosmos is running"; harness set -u and init check
#### Pass 9: c96eebf66
- [WARNING] missing first-stop failing-start arm; person-stopped arm could not fail on a start --> both added; plan matches
#### Pass 10: 77e1827bf
- [WARNING] plan presented the forced start at these stops as measured --> says reasoned from main's code, not measured
#### Pass 11
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs
**Converged.**

### Deferred, with reasons
- A real `kosmos start --force` against a live board in a sandbox is not exercised by any arm (the harness stub only
  exits 0 or 1). Not new: main already runs that start at these points; recorded in the plan as reasoned, not measured.
- The marker take-back half of the trap (#5033) is unchanged here and covered by main's tests.

### Observed during validation, not caused by this branch
- test-pause-foreign-board-964 prints `_kosmos_mode_keeps_board_off: command not found` three times and passes 12/12.
  Measured identical on a clean origin/main tree (3 lines, 12/12), so it predates this branch.

### Strengths
- Every rejected design is named in the plan with the pass that caught it
- The harness runs main's real `_kosmos_put_board_back` (extracted), and is red with the flag removed and with it on the third stop
