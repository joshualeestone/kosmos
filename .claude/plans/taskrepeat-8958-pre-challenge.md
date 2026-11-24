---
pre_challenge: true
method: challenge-loop
branch: taskrepeat-8958
diff_hash: 654572bdee4751c9a83d26c753f4ec518a4e69d6b1e9ba05c612fe80d127715b
validation: passed
subdir_audit: passed
timestamp: 2026-11-24T17:11:50Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No (stopped at the 8-round cap, Splinter's standing usage rule of 10-22 and 10-26: stop at 8 unless a BLOCKER is open; none was open after iteration 8)
**Total findings:** 21 actionable (1 BLOCKER, 19 WARNINGs, 1 CONVENTION) plus NITs
**Fixed:** 20 | **Deferred:** 1 | **Asked (awaiting user):** 0

Stacked on taskhold-8958 (#8958 slice B2) at 8005f4724c; every reviewer was given only 8005f4724c..HEAD.
Validation: full run through the heavy queue at head 7235601ad1, validation_rc=0 audit_rc=0, rc=0 (11:09 CST),
hash 654572bdee47 (this proof's diff hash). A simulator run of mine overlapped its shell shards for about a minute
(stopped); the run still passed. Between rounds: ios/LogicTests/run-taskpage.sh (285/285 at the end), the iOS 16
swiftc typecheck of ios/Kosmos, and TaskPageActionsUITests on a fresh iPhone 16e simulator (4/4 after every round
that changed the view). All 13 ios LogicTests runners passed after iteration 1 (TasksLogic.swift is shared).
Every new guard was proven by mutation: removing it turned its own test red, then the file was restored.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 3 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 0
- [WARNING] TaskPageView.swift edit closure: a draft equal to the stored rule was dropped mid-edit (60 minutes became Every hour) --> FIXED (b47c7dd499)
- [WARNING] TaskPageView.swift: the minutes number pad had no way to close --> FIXED (b47c7dd499)
- [WARNING] TaskPageModel.swift saveRepeat: draft cleared and Saved. said even when the read after the save failed --> FIXED (b47c7dd499)
- [CONVENTION] plan: other runners compiling TasksLogic.swift not run or recorded --> FIXED (all 13 runners green, recorded)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs, 4 NITs
**Self-generated:** 1
- [WARNING] TaskPageView.swift onChange: a draft equal to the OLD rule was kept when the rule changed elsewhere, so Save could clear an agent's rule --> FIXED (7f72516197, Board.followStored, tests)
- [WARNING] TaskPageView.swift: menu Pickers without labelsHidden --> FIXED (7f72516197)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 3 WARNINGs, 3 NITs
**Self-generated:** 3
- [BLOCKER] TaskPageLogic.swift keptRepeatDraft: others re-derived before comparing, so a daily time moved past the other and saved left Save lit, and a second Save dropped a time --> FIXED (1f9f940f95, compare first; 2 tests, mutation red)
- [WARNING] main.swift: no test moved the box past another time --> FIXED (1f9f940f95)
- [WARNING] TaskPageView.swift: Mark as done not drawn off during a repeat save --> FIXED (1f9f940f95)
- [WARNING] TaskPageView.swift: view wiring exercised by no test --> FIXED (1f9f940f95: the sample board stores a repeat rule; UI test testRepeatIsChangedAndSaved, light and dark; ui-sample tally 3 to 4)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs, 6 NITs
**Self-generated:** 2
- [WARNING] TaskPageView.swift onChange: an unproven claim that a capture list holds the old rule --> FIXED (4e8fa1c97a, repeatDraftBase state)
- [WARNING] TaskPageModel.swift: the save and press guards had no test that could fail --> FIXED (4e8fa1c97a, 3 tests, each mutation red)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 2 WARNINGs, 4 NITs
**Self-generated:** 2
- [WARNING] TaskPageView.swift: after saving a box moved past the other time, the box jumped to the sorted first --> FIXED (473befb15f, Board.repeatShown; 3 tests, mutation red)
- [WARNING] TaskPageActionsUITests.swift: the Save-off assertion could not fail while the save was in flight --> FIXED (473befb15f, waits for Saved. first)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 3 WARNINGs, 4 NITs
**Self-generated:** 2
- [WARNING] TaskPageView.swift: the saved box was set after the save's reads, so it flickered mid-save --> FIXED (94e69e3d95)
- [WARNING] TaskPageView.swift: the saved box was never forgotten on a change from elsewhere --> FIXED (94e69e3d95)
- [WARNING] the taller sample task 4 might push other UI tests past their swipe bound --> DEFERRED: measured, TaskPageActionsUITests 4/4 locally after iterations 3, 4 and 5

#### Iteration 7
**Reviewer model:** opus
**New findings:** 2 WARNINGs, 4 NITs
**Self-generated:** 2
- [WARNING] TaskPageLogic.swift keptRepeatDraft: other times followed only on a daily draft, so a weekly draft switched back to daily resent a time an agent had removed --> FIXED (ae72551763, follows for every frequency; test, mutation red)
- [WARNING] TaskPageView.swift: the saved box was kept after a refused or unsent save --> FIXED (ae72551763)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs, 3 NITs
**Self-generated:** 2
- [WARNING] TaskPageView.swift: the announcement relied on the line being removed between two texts --> FIXED (7235601ad1, .id on each line)
- [WARNING] plan: the claim about a failed read after a save was stronger than what is tested --> FIXED (7235601ad1, reworded and named as untested view state)

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | TaskPageView.swift | BRANCH | draft dropped mid-edit | FIXED | b47c7dd499 |
| 2 | 1 | WARNING | TaskPageView.swift | BRANCH | number pad cannot close | FIXED | b47c7dd499 |
| 3 | 1 | WARNING | TaskPageModel.swift | BRANCH | Saved. after a failed read | FIXED | b47c7dd499 |
| 4 | 1 | CONVENTION | plan | BRANCH | runners not recorded | FIXED | b47c7dd499 |
| 5 | 2 | WARNING | TaskPageView.swift | SELF | stale draft over a changed rule | FIXED | 7f72516197 |
| 6 | 2 | WARNING | TaskPageView.swift | BRANCH | Picker titles drawn | FIXED | 7f72516197 |
| 7 | 3 | BLOCKER | TaskPageLogic.swift | SELF | a saved daily time dropped | FIXED | 1f9f940f95 |
| 8 | 3 | WARNING | main.swift | SELF | no moved-past test | FIXED | 1f9f940f95 |
| 9 | 3 | WARNING | TaskPageView.swift | SELF | Done not drawn off | FIXED | 1f9f940f95 |
| 10 | 3 | WARNING | TaskPageView.swift | BRANCH | view wiring untested | FIXED | 1f9f940f95 |
| 11 | 4 | WARNING | TaskPageView.swift | SELF | capture-list claim | FIXED | 4e8fa1c97a |
| 12 | 4 | WARNING | TaskPageModel.swift | SELF | guards untested | FIXED | 4e8fa1c97a |
| 13 | 5 | WARNING | TaskPageView.swift | SELF | box jumps after save | FIXED | 473befb15f |
| 14 | 5 | WARNING | TaskPageActionsUITests.swift | SELF | assertion could not fail | FIXED | 473befb15f |
| 15 | 6 | WARNING | TaskPageView.swift | SELF | box flicker mid-save | FIXED | 94e69e3d95 |
| 16 | 6 | WARNING | TaskPageView.swift | SELF | box never forgotten | FIXED | 94e69e3d95 |
| 17 | 6 | WARNING | TaskPageView.swift | BRANCH | taller sample page | DEFERRED | UI 4/4 measured |
| 18 | 7 | WARNING | TaskPageLogic.swift | SELF | removed time resent | FIXED | ae72551763 |
| 19 | 7 | WARNING | TaskPageView.swift | SELF | box kept after refusal | FIXED | ae72551763 |
| 20 | 8 | WARNING | TaskPageView.swift | SELF | announcement dependency | FIXED | 7235601ad1 |
| 21 | 8 | WARNING | plan | SELF | overstated claim | FIXED | 7235601ad1 |

### Outstanding questions (ASKED, still unresolved when the run ended)
- None.

### NITs (non-blocking, across all iterations)
- [NIT] repeatWire sends an unnormalised overlong digit string where the board folds it; the Mac refuses it (iteration 3, left)
- [NIT] the sample board's daily and weekly words are not the board's describe (iterations 4, 5, 8; the comment says so, only hourly and task 4's start are asserted)
- [NIT] "Choose a time" cannot be reached with a DatePicker (iteration 8, left: matches the board's contract)
- [NIT] minutes box not filtered for non-digits (iteration 6, deliberate: the Mac refuses them, pinned by a test)
- the rest were fixed in the iteration that raised them (Cancel's busy state, comments, test names, 44 pt per control)

### Strengths (across all iterations)
- repeatWire and repeatStored match the board's tkRepeatChoice and tkRepeatStoredChoice (030 is 30, 60 minutes is hourly, daily times sorted, an empty box sends nothing)
- a rule the controls cannot show is never shown as another rule; the page sends the person to the board
- one reader (Board.fillRepeat) for the Tasks row and the task page
- times pinned to a fixed calendar, so the phone's time zone never moves the computer's clock
