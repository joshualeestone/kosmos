---
pre_challenge: true
method: challenge-loop
branch: uikitlist-s11-8221
diff_hash: 665ba967f44eeeba0b498428c57290feb4f78ad289dde5d517a35ba8eae359c4
validation: passed
subdir_audit: passed
timestamp: 2026-11-10T00:57:12Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No (stopped at the standing 8-round cap, Splinter 2026-10-31: "8 rounds unless a BLOCKER is still open; past 8, put the remaining WARNINGs on a follow-up card and ship". No BLOCKER was raised in any round. Remaining warnings are on #8221, comment 6753492688.)
**Total findings acted on:** 0 BLOCKERs, 21 WARNINGs, 3 CONVENTIONs, plus NITs
**Fixed:** 17 | **Deferred:** 7 (4 to the #8221 follow-up) | **Asked (awaiting user):** 0

After the cap, the final simulator run found that one fix did not work (the jump-to-newest check failed 2 of 2): stopping a running scroll by writing its offset is unreliable. It was replaced by closing the window only, measured 3 of 3 traced and then 14 of 14 (seven checks, two rounds); final validation passed on that code. A first full validation failed on tools.plus-signin-2036.test.js, which passes alone (23 of 23); the rerun passed.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above (ITER_COMMITS empty)
- [WARNING] ios/Kosmos/ChatList.swift:235 — a press that moves nothing opened the window and turned off pinning --> FIXED (a85347ef9e): the window opens on the scroll's first move
- [WARNING] ios/Kosmos/ChatList.swift:208 — the list's own offset writes counted as the person's --> FIXED (a85347ef9e)
- [WARNING] ios/KosmosUITests/A11yScrollUITests.swift:44 — the extension and lapse paths were untested --> FIXED (a85347ef9e): stepped and still modes
- [WARNING] ios/KosmosUITests/A11yScrollUITests.swift:1 — the check drives the scroll by hand --> FIXED (a85347ef9e): named as the weakest premise
- [NIT] lapse queue, personUntil left stale on a finger, debugPins wording, ui-sample comment order, unbounded parse --> fixed or noted

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 2 of the above (lines from a85347ef9e)
- [WARNING] ios/Kosmos/ChatList.swift:257 — an unused ask left dragged set --> FIXED (01a2500396)
- [WARNING] ios/Kosmos/ChatList.swift:232 — a 1.0 s ask window is wide --> FIXED (01a2500396): 0.5 s
- [WARNING] ios/Kosmos/ChatList.swift:359 — a row landing during the scroll is not followed until the moves stop --> DEFERRED: by design, at most 0.3 s
- [WARNING] ios/KosmosUITests/A11yScrollUITests.swift:59 — the stepped control relies on a layout per move --> DEFERRED: measured red (14 and 24 pins)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1 of the above
- [WARNING] ios/Kosmos/ChatList.swift:536 — a jump to the newest during the window did not close it --> FIXED (af6aec5740)
- [WARNING] ios/Kosmos/ChatList.swift:263 — a second ask during a window misfired its timer --> FIXED (af6aec5740)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 2 of the above
- [WARNING] ios/Kosmos/ChatList.swift:304 — another scroll's end closed the window --> FIXED (bdcc584c69)
- [WARNING] ios/Kosmos/ChatList.swift:284 — a stalled frame let the lapse hold the place and stop the scroll --> FIXED (bdcc584c69)
- [WARNING] ios/Kosmos/ChatList.swift:233 — an unrelated move inside the ask window counts as the person's --> DEFERRED: bounded, documented, to #8221
- [WARNING] ios/KosmosUITests/A11yScrollUITests.swift:49 — the animated check did not assert the window opened --> FIXED (bdcc584c69)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1 of the above
- [WARNING] ios/Kosmos/ChatList.swift:312 — a fling's end between the ask and the first move wiped the ask --> FIXED (74070a30e9)
- [WARNING] ios/Kosmos/ChatList.swift:552 — the jump stop was untested --> FIXED (74070a30e9): jump mode
- [WARNING] ios/Kosmos/ChatList.swift:59 — VoiceOver's one-finger swipe is not covered --> DEFERRED: scope, stated in the plan, the PR and #8221

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 2 of the above
- [WARNING] ios/Kosmos/ChatList.swift:268 — an ask counted as a drag before its scroll moved --> FIXED (cc43debc54)
- [WARNING] ios/Kosmos/ChatList.swift:295 — lapse checks of closed windows kept running --> FIXED (cc43debc54): numbered windows

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 6 WARNINGs, 2 CONVENTIONs, 2 NITs
**Self-generated:** 3 of the above
- [WARNING] ios/Kosmos/ChatList.swift:269 — a second ask near a lapse was lost --> FIXED (23810eecf6)
- [WARNING] ios/Kosmos/ChatList.swift:297 — a stall over 0.3 s lapses the window mid-animation --> DEFERRED: to #8221
- [WARNING] ios/Kosmos/ChatList.swift:316 — the status-bar tap is the same kind of scroll --> FIXED (23810eecf6)
- [WARNING] ios/Kosmos/ChatList.swift:485 — rows landing above during such a scroll --> FIXED in part (23810eecf6, then 1dec0b56a8): the window closes; the scroll may carry on to its old target, to #8221
- [WARNING] ios/KosmosUITests/A11yScrollUITests.swift:84 — the still check's drag assertion had no control --> FIXED (23810eecf6)
- [CONVENTION] mode counts and plan names stale --> FIXED (23810eecf6)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above acted on (stopped at the cap)
- [WARNING] ios/Kosmos/ChatList.swift:324 — a stale animation end can clear a pending ask in a rapid double scroll --> DEFERRED: to #8221 (cap)
- [WARNING] ios/Kosmos/ChatList.swift:239 — an unrelated move within 0.5 s of an ask --> duplicate of iteration 4's deferral
- [WARNING] ios/Kosmos/ChatList.swift:269 — the space bar as a scroll key --> DEFERRED: to #8221 (cap)

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | ios/Kosmos/ChatList.swift:235 | BRANCH | press that moves nothing opened the window | FIXED | a85347ef9e |
| 2 | 1 | WARNING | ios/Kosmos/ChatList.swift:208 | BRANCH | own writes counted as the person's | FIXED | a85347ef9e |
| 3 | 1 | WARNING | A11yScrollUITests.swift:44 | BRANCH | extension and lapse untested | FIXED | a85347ef9e |
| 4 | 1 | WARNING | A11yScrollUITests.swift:1 | BRANCH | hand-driven scroll unnamed | FIXED | a85347ef9e |
| 5 | 2 | WARNING | ios/Kosmos/ChatList.swift:257 | SELF | unused ask left dragged | FIXED | 01a2500396 |
| 6 | 2 | WARNING | ios/Kosmos/ChatList.swift:232 | SELF | ask window wide | FIXED | 01a2500396 |
| 7 | 2 | WARNING | ios/Kosmos/ChatList.swift:359 | BRANCH | row landing not followed during scroll | DEFERRED | by design |
| 8 | 2 | WARNING | A11yScrollUITests.swift:59 | BRANCH | stepped control relies on layout | DEFERRED | measured red |
| 9 | 3 | WARNING | ios/Kosmos/ChatList.swift:536 | BRANCH | jump did not close the window | FIXED | af6aec5740 |
| 10 | 3 | WARNING | ios/Kosmos/ChatList.swift:263 | SELF | second ask misfired timer | FIXED | af6aec5740 |
| 11 | 4 | WARNING | ios/Kosmos/ChatList.swift:304 | SELF | another scroll's end closed the window | FIXED | bdcc584c69 |
| 12 | 4 | WARNING | ios/Kosmos/ChatList.swift:284 | SELF | stall let the lapse freeze the scroll | FIXED | bdcc584c69 |
| 13 | 4 | WARNING | ios/Kosmos/ChatList.swift:233 | BRANCH | unrelated move in ask window | DEFERRED | #8221 |
| 14 | 4 | WARNING | A11yScrollUITests.swift:49 | BRANCH | animated check lacked window assert | FIXED | bdcc584c69 |
| 15 | 5 | WARNING | ios/Kosmos/ChatList.swift:312 | SELF | fling end wiped the ask | FIXED | 74070a30e9 |
| 16 | 5 | WARNING | ios/Kosmos/ChatList.swift:552 | BRANCH | jump untested | FIXED | 74070a30e9 |
| 17 | 5 | WARNING | ios/Kosmos/ChatList.swift:59 | BRANCH | one-finger swipe not covered | DEFERRED | scope |
| 18 | 6 | WARNING | ios/Kosmos/ChatList.swift:268 | SELF | ask counted as drag before moving | FIXED | cc43debc54 |
| 19 | 6 | WARNING | ios/Kosmos/ChatList.swift:295 | SELF | stale lapse chains | FIXED | cc43debc54 |
| 20 | 7 | WARNING | ios/Kosmos/ChatList.swift:269 | SELF | second ask near lapse lost | FIXED | 23810eecf6 |
| 21 | 7 | WARNING | ios/Kosmos/ChatList.swift:297 | BRANCH | wall-clock lapse on a stall | DEFERRED | #8221 |
| 22 | 7 | WARNING | ios/Kosmos/ChatList.swift:316 | BRANCH | status-bar tap | FIXED | 23810eecf6 |
| 23 | 7 | WARNING | ios/Kosmos/ChatList.swift:485 | SELF | rows landing above mid-scroll | FIXED (partly) | 1dec0b56a8, rest #8221 |
| 24 | 8 | WARNING | ios/Kosmos/ChatList.swift:324 | SELF | stale animation end clears an ask | DEFERRED | #8221 (cap) |

### Outstanding questions (ASKED, still unresolved when the run ended)
- None.

### NITs (non-blocking, across all iterations)
- [NIT] ios/Kosmos/ChatList.swift — lapse chains, timer bookkeeping, comment wording across iterations 1 to 8 (most fixed in passing)
- [NIT] ios/KosmosUITests/A11yScrollUITests.swift — the report is parsed by words; a format change fails loudly as unreadable

### Strengths (across all iterations)
- Control arms with the fix off (animated, stepped, still) prove each check can see the defect (iterations 1, 7)
- The window opens on a real move, extends with each move, lapses safely, and defers to a finger (iterations 3 to 8)
- The cause was measured before the fix: 18 pins in one page scroll, which ended where it began
