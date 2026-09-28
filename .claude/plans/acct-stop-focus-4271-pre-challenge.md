---
pre_challenge: true
method: challenge-loop
branch: acct-stop-focus-4271
diff_hash: 63c6a4b3efc956a4951ed1d602657d724798cdd45f19b3246c1f461a4ca48fe9
validation: passed
subdir_audit: passed
timestamp: 2026-09-28T03:02:33Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes
**Total findings:** 18 actionable (1 BLOCKER, 11 WARNINGs, 6 CONVENTIONs incl. synthetic validation findings), 14 NITs
**Fixed:** 18 | **Deferred:** 0 | **Asked (awaiting user):** 0

Evidence, all against the hermetic check docs/browser-checks/render-acct-stop-focus-4271.js:
25 PASS with the fix (4/4 consecutive runs at load 19). Control (origin/main page): arms 1, 2, 4
read BODY. Mutants: connected guard dropped -> arm 3 focusin log reds; focusWasInFlow guard
dropped -> arm 5 reds. Unit web.acct-focus-after-flow-4271.test.js: 4/4, mutants on the disabled
check and the trigger visibility guard each red. web.connect-success-1656: dropped connected guard
reds with ReferenceError. Both browser-check gates pass.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 4 CONVENTIONs (validation), 3 NITs
**Self-generated:** 0 of the above (ITER_COMMITS empty; validation findings are BRANCH by instruction)
- [CONVENTION] initial-validation: browser-checks-indexed (README row missing) --> FIXED (fe82e1c)
- [CONVENTION] initial-validation: reason-grep EXPECTED_SITES / EXPECTED_CATCH_SITES --> FIXED (fe82e1c, measured +1 each)
- [CONVENTION] initial-validation: tools.browser-checks-wired (not wired) --> FIXED (fe82e1c, hermetic + gated.txt)
- [WARNING] render-acct-stop-focus-4271.js arm 3 could not see a move overwritten by acctShowSuccess --> FIXED (fe82e1c, focusin log)
- [WARNING] plan/commit claimed 13/13 when the check had 12 assertions --> FIXED (fe82e1c, counts measured)
- [WARNING] web/index.html acctAddStart: a start answering an ended phase stranded focus --> FIXED (fe82e1c)
- [NIT] picker fallback focused a hidden trigger --> applied (fe82e1c); [NIT] note rationale --> plan; [NIT] arm 2 comment --> applied

6g validation: [CONVENTION] engine/status.tmux-bin (tmux at /bin/echo, no pane source) --> FIXED (f92b10a, fleet.install([])). One red set was load contention (remote, updating-988, guide-on-connect-3660; 144/144 alone).

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 (acctAddStart tail, code, fixed normally)
- [WARNING] web/index.html acctAddStart tail re-derived the focus fallback --> FIXED (c433661, reuses acctFocusAfterFlow)
- [WARNING] check arm 4 used phase 'failed', which engine/connect.js never writes --> FIXED (c433661, 'stuck')
- [NIT] comment glossed the idle case --> applied; [NIT] acctMuseShow lacks the trigger visibility guard (pre-existing)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 2 (check arm 4 and its header, both this loop's)
- [WARNING] no arm proved focus elsewhere is left alone (focusWasInFlow guard) --> FIXED (94dbed1, arm 5, mutant reds)
- [WARNING] arm 4's stub poll disagreed with the start answer --> FIXED (94dbed1)
- [CONVENTION] "each arm asserts focus first" was untrue for arm 4 --> FIXED (94dbed1)
- [NIT] leftover poll after an ended start (pre-existing) --> filed #4275; other NITs recorded

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 0 NITs
**Self-generated:** 1 (the count comment)
- [WARNING] reason-grep comment credited the chk() line; the +1 is the top-level .catch --> FIXED (7daabf3, measured by removing the line: both counts drop by one)
- [WARNING] picker fallback untested --> FIXED (7daabf3, web.acct-focus-after-flow-4271.test.js, mutants red)
- [CONVENTION] decision not on the card --> FIXED (card comment 5862148354)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 (arm 4 wait)
- [BLOCKER] arm 4 read on a fixed clock and went red under load --> FIXED (1deed21, waits on the start response and the page settling; separately measured a 30s click timeout from a poll left running by #4275 leaking into arm 5, fixed by applying the stub's phase when the start request arrives; 4/4 runs green after)
- [WARNING] plan presented arm 4 as settled --> FIXED (1deed21)
- [NIT] header said four arms --> applied; [NIT] temp dirs left --> applied (removed on exit); [NIT] nested if on one line --> applied

6g validation after iteration 5: PASSED on 1deed21 (full suite + build), subdir audit clean.

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | CONVENTION | browser-checks-indexed | BRANCH | README row | FIXED | fe82e1c |
| 2 | 1 | CONVENTION | browser-checks-reason-grep | BRANCH | emit counts | FIXED | fe82e1c |
| 3 | 1 | CONVENTION | browser-checks-reason-grep | BRANCH | catch counts | FIXED | fe82e1c |
| 4 | 1 | CONVENTION | tools.browser-checks-wired | BRANCH | not wired | FIXED | fe82e1c |
| 5 | 1 | WARNING | render-acct-stop-focus-4271.js arm 3 | BRANCH | overwritten move invisible | FIXED | fe82e1c |
| 6 | 1 | WARNING | plan | BRANCH | wrong assertion count | FIXED | fe82e1c |
| 7 | 1 | WARNING | web/index.html acctAddStart | BRANCH | ended start strands focus | FIXED | fe82e1c |
| 8 | 1 | CONVENTION | engine/status.tmux-bin | BRANCH | no pane source | FIXED | f92b10a |
| 9 | 2 | WARNING | web/index.html acctAddStart | SELF | re-derived fallback | FIXED | c433661 |
| 10 | 2 | WARNING | check arm 4 | SELF | unreachable phase | FIXED | c433661 |
| 11 | 3 | WARNING | check | BRANCH | guard unproven | FIXED | 94dbed1 |
| 12 | 3 | WARNING | check arm 4 | SELF | stub mismatch | FIXED | 94dbed1 |
| 13 | 3 | CONVENTION | check header/README/plan | SELF | overclaim | FIXED | 94dbed1 |
| 14 | 4 | WARNING | browser-checks-reason-grep | SELF | misattributed count | FIXED | 7daabf3 |
| 15 | 4 | WARNING | web/index.html acctFocusAfterFlow | BRANCH | fallback untested | FIXED | 7daabf3 |
| 16 | 4 | CONVENTION | #4271 | BRANCH | decision not on card | FIXED | card comment |
| 17 | 5 | BLOCKER | check arm 4 | SELF | clock wait, flaky | FIXED | 1deed21 |
| 18 | 5 | WARNING | plan | SELF | arm 4 overstated | FIXED | 1deed21 |

### NITs (non-blocking, across all iterations)
- acctMuseShow's picker fallback has no visibility guard (pre-existing; iterations 2, 6)
- acctFocusAfterFlow's comment says "as acctMuseShow does" though it adds a visibility guard (iteration 6)
- the polled-failure focus goes to Start while the note speaks via its live region; a screen-reader pass would settle it (iteration 3)
- commit 266b21c's message describes the first version of the check (iteration 3)

### Strengths (across all iterations)
- focus is read before the panel is hidden; Connected is left to acctShowSuccess (all)
- the check is hermetic, drives real buttons and the real poll, and every arm is shown able to fail (control + two mutants)
- pre-existing poll leak split out as #4275 with observed evidence rather than folded in
