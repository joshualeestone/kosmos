---
pre_challenge: true
method: challenge-loop
branch: setuppolish-7205
diff_hash: 670c63f43c18ea55e1f7d500494462999c83d6da50bd9be44de2a9e770572e1d
validation: passed at f603e18978 rebased on origin/main (root unit set 3554/3554; swiftc -typecheck exit 0; render-firstrun-choice-4356 50 passed; render-firstrun-s6-2037 OK; render-layer-gutter-4494 13 passed; render-win32-board-copy 180/180; #2518 surface gate and #1720 gate exit 0)
subdir_audit: passed (no CLAUDE.md in the diff)
timestamp: 2026-10-26T16:57:43Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5 (blind reviewers; round 1 before the restart, rounds 2 to 4 after; files .claude/plans/setuppolish-7205-review1..4.md)
**Converged:** Yes (round 4: no new BLOCKER or WARNING; its two nits fixed and pinned)

### Per-Iteration Breakdown

#### Iteration 1
[BLOCKER] Run, Back, Both lost ?mode=both, so first run did not end at the Kosmos Plus sign-in. Fixed; C11 asserts it.
[BLOCKER] #2518 surface gate red for render-layer-gutter-4494 and render-win32-board-copy. Both run and pass; trailers.
[WARNING] Run, Back, Connect could leave a late board start running. Fixed in ensureBoardRunning.
[WARNING] Windows takes one answer per launch, yet Back was offered there. Back is Mac-bridge only now; C11 control.
[NIT] six; four taken (dots after restart screen, focus after Back, doc comment, Reload note), two left (cosmetic).

#### Iteration 2
[WARNING] the Welcome-with-Back design-shot screen had no Mac bridge after the fix. Fixed, re-shot (16 ok).
[NIT] four: a wrong trailer reason (restated), a stale comment, modeAskedThisLaunch not cleared on Connect, plan counts.

#### Iteration 3
[WARNING] the Mac half had no test that could fail. Tests added; the reviewer's four mutations each fail them.
[NIT] the Connect save-failure alert was false after Run, Back, Connect. Worded by mode.

#### Iteration 4
[NIT] "on this computer" twice in the alert; its wording unpinned. Both fixed (forcing the old wording now fails).
No new BLOCKER or WARNING.

#### Iteration 5
Full validation once at convergence, after rebasing on origin/main: all green (above). No issues found.
