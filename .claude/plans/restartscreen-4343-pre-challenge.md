---
pre_challenge: true
method: challenge-loop
branch: restartscreen-4343
diff_hash: bd2a96498243466f4c78ee590d99ff79e4c6df751aaf395f42fb4a051d3e4526
validation: passed
subdir_audit: passed
timestamp: 2026-09-28T17:37:33Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 blind reviews, plus three 6g/6j validation findings fed back into the loop
**Converged:** Yes (iteration 8: NITs only; the final 6j run on this HEAD is green)
**Total findings:** 26 (3 BLOCKERs from review, 3 validation BLOCKERs, 18 WARNINGs, 2 CONVENTIONs), plus NITs
**Fixed:** 24 | **Deferred:** 2 | **Asked (awaiting user):** 0

Card #4343: "Kosmos requires a full restart", one clean centered screen with nothing else on it when
this window's board stops answering. Josh approved the look at 10:45 ("beautiful on that"). Homer's
Windows wording was taken as written.

Validation history, stated plainly:
- 6g after iteration 1: one failure. A ninth inline capitalizer (web.open-sentence-1199) was replaced by asSentence (13aa3b8).
- 6g after iteration 2: green on 59b1e41.
- After iteration 5: 6j found two modal-sweep failures (web.modal-way-out-1316). The screen's alertdialog was being counted under a wrong name. The fix gives it the id restart-screen, states its deliberate no-Escape exclusion, and pins the key-stopping listener (7df42c2).
- Two runs were stopped unfinished, each with its whole process group and no orphans left, because a review round had already found code to change.
- Final 6j on this HEAD (43c5248): 11292 tests, 0 fail, subdir audit clean.

Every fix came with a control: the change removed or reverted, the arm confirmed red, then restored.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [BLOCKER] reason-grep EXPECTED_SITES/EXPECTED_CATCH_SITES not updated --> FIXED (measured 198/121, 523fa1a)
- [WARNING] a parsed 200 whose painter threw counted as "nothing answered" (would lock a person out of a live board) --> FIXED (answered = true after res.json, 0af6ac7)
- [WARNING] recovery not tested end to end --> FIXED (real poll 'up' mode, 0af6ac7)
- [WARNING] scrollbar gutter showed through --> FIXED (html.restart-up)
- [WARNING] a non-existent colour token --> FIXED
- NITs taken: late-added body nodes inerted, focus returned, calls try-isolated, file:// positive control, inert compared by identity.

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] a duplicated remote-view test --> FIXED (offlineRemoteView, 167d7e6)
- [WARNING] Windows remedy untested --> FIXED (baked /win page arm)
- [WARNING] baked version untested --> FIXED (same arm)

#### Iteration 3
**Reviewer model:** opus
- [WARNING] a world switch longer than 15 s drew the screen --> FIXED (WORLDSW_SWITCHING stand-down, fresh clock, ad352d0)
- [WARNING] a stale sign-in flag could survive a good read --> FIXED
- [WARNING] role=alert on a focused modal --> FIXED (alertdialog, aria-modal, labelled and described)

#### Iteration 4
**Reviewer model:** sonnet
- [BLOCKER] Windows copy was the wording Homer flagged --> FIXED (his wording, f7efb94)
- [WARNING] What's New, tips and the update dialog could act behind the screen --> FIXED

#### Iteration 5
**Reviewer model:** opus
- [BLOCKER] conflict with main (#4288's Community notice) --> FIXED (rebased, both selectors kept, cnHeld covers it)
- [WARNING] about fifteen document-level Escape/Tab handlers could act behind the screen --> FIXED (one window capture listener, 69ee36c)
- [WARNING] no key was ever pressed in the check --> FIXED (Escape and Tab with a dialog open underneath)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** NITs only (converged at 6d). 6j then found the modal-sweep failures (above) --> FIXED, and the loop went on.

#### Iteration 7
**Reviewer model:** opus
- [WARNING] "Command-Q" was shown in a browser tab too, where it quits the browser --> FIXED (restartHowMac: Command-Q only in the Kosmos app, 43c5248)
- [WARNING] the #4342 dependency (a hung board, no fetch timeout) not stated on the card --> FIXED (card comment)
- NITs taken: offlineRemoteView moved above paintOfflineNote's docblock; the dark pass proves it ran dark.

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Converged** - no new actionable findings.

### Final Ledger (actionable findings)

| # | Iter | Category | Area | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | reason-grep counts | BRANCH | counts not updated | FIXED | 523fa1a |
| 2 | 1 | WARNING | tick() answered | BRANCH | throwing painter read as outage | FIXED | 0af6ac7 |
| 3 | 1 | WARNING | check | BRANCH | recovery not end to end | FIXED | 0af6ac7 |
| 4 | 1 | WARNING | CSS | SELF | scrollbar gutter | FIXED | 0af6ac7 |
| 5 | 1 | WARNING | CSS | SELF | missing token | FIXED | 0af6ac7 |
| 6 | 6g | BLOCKER | web.open-sentence-1199 | SELF | ninth inline capitalizer | FIXED | 13aa3b8 |
| 7 | 2 | WARNING | paintOfflineNote | SELF | duplicated remote test | FIXED | 167d7e6 |
| 8 | 2 | WARNING | check | SELF | Windows remedy untested | FIXED | 167d7e6 |
| 9 | 2 | WARNING | check | SELF | baked version untested | FIXED | 167d7e6 |
| 10 | 3 | WARNING | paintRestartScreen | SELF | world switch covered | FIXED | ad352d0 |
| 11 | 3 | WARNING | tick() | SELF | stale sign-in flag | FIXED | ad352d0 |
| 12 | 3 | WARNING | markup | SELF | alert role on a modal | FIXED | ad352d0 |
| 13 | 4 | BLOCKER | windowsCopyTable | SELF | Windows wording Homer flagged | FIXED | f7efb94 |
| 14 | 4 | WARNING | overlays | BRANCH | dialogs acting behind the screen | FIXED | f7efb94 |
| 15 | 5 | BLOCKER | branch | BRANCH | conflict with main | FIXED | rebase |
| 16 | 5 | WARNING | keyboard | BRANCH | handlers behind the screen | FIXED | 69ee36c |
| 17 | 5 | WARNING | check | SELF | no key pressed | FIXED | 69ee36c |
| 18 | 6j | BLOCKER | web.modal-way-out-1316 | SELF | modal counted under a wrong name | FIXED | 7df42c2 |
| 19 | 7 | WARNING | copy | SELF | Command-Q in a browser tab | FIXED | 43c5248 |
| 20 | 7 | WARNING | card | BRANCH | #4342 dependency unstated | FIXED | card comment |
| 21 | 1 | CONVENTION | plan | BRANCH | plan file present | DEFERRED | not a defect |
| 22 | 7 | CONVENTION | plan | BRANCH | plan matches card | DEFERRED | not a defect |

### NITs (non-blocking, across all iterations)
- The 15 s clock starts at the first failed poll; a hung board waits on #4342 (stated on the card).
- Restore un-inerts what the screen took even if other code inerted it meanwhile (unreachable today).
- The window listener queries the DOM per keydown (cheap; pinned by the modal sweep).
- restartHowMac detects the app inline, the same way tick() does for the badge.
- The message has no visible focus ring and Tab can leave to browser chrome (nothing on it to press).
- Setup is several DOM steps with no rollback if one threw (plain DOM ops).

### Strengths (across all iterations)
- A separate painter, try-isolated at both call sites; the offline note keeps its own rules and tests.
- One window capture listener keeps every key from the page behind the screen, present and future.
- Inert handling gives back exactly what it took, by identity, including late-added nodes.
- The check drives the real poll against a dropping server, with positive controls on every negative arm.
