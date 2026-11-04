---
pre_challenge: true
method: challenge-loop
branch: connecting-7954
diff_hash: 01c79aa51e1eb23040e6a9697dee5dc89024de55b237aae35d9e5ae7e314af75
validation: passed
subdir_audit: passed
timestamp: 2026-11-04T17:51:39Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes
**Total findings:** 11 actionable (0 BLOCKERs, 10 WARNINGs, 0 CONVENTIONs, plus 1 synthetic baseline finding), 9 NITs
**Fixed:** 8 | **Deferred:** 4 | **Asked (awaiting user):** 0

Baseline (6.0): the full suite failed 4 of 27016 tests under a load average of 35 (killed runners, exit 143 and null; a
launch control that never launched). The three files re-run alone: 57/57 pass, rc 0; none touch this branch. Recorded as
a synthetic finding and deferred as machine load; the closing gate (6j) ran the full suite again: 27017 tests, 0 fail.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above (ITER_COMMITS empty)
- [WARNING] ios/Kosmos/AgentsView.swift:389 - .connecting(mac) still showed the orb for the same wait --> FIXED (560c488920)
- [WARNING] ios/LogicTests/sweep/main.swift:3 - "against the board's numbers" but nothing read the board --> FIXED: suite reads web/index.html and pins every copied value, with a control (560c488920)
- [WARNING] ios/LogicTests/sweep/main.swift:17 - fall edge unchecked; a p < 0.70 mutant passed --> FIXED: checks just before and at 72% (560c488920)
- [WARNING] ios/Kosmos/SettingsView.swift:134 - "Connecting..." wrong for a read from an already-connected computer (also ProjectsView:831) --> FIXED: both reverted to main (560c488920)
- [WARNING] ios/Kosmos/SweepLogic.swift:3 - comments implied the live board shows these dots --> FIXED: says it ports the CSS; the board draws its orb over them since #7896 (560c488920)
- [NIT] SweepDots.swift:21 - a lit dot overhangs the frame --> fixed anyway: ring pulled in (560c488920)
- [NIT] SweepDots.swift:10 - 20 pt and Dynamic Type growth larger than the board's 16 px
- [NIT] plan:21 - build step had no command --> fixed (560c488920)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above (both cite lines on main or unchanged by loop fixes)
- [WARNING] ios/Kosmos/AgentsView.swift:392 - the allow screen keeps the orb beside the dots --> DEFERRED: by design, a different wait (a person at the Mac); recorded on the card
- [WARNING] ios/Kosmos/AgentsView.swift:429 - Agents and Projects word their first wait differently --> DEFERRED: by design per review 1; my earlier card comment said "all three", so it was marked superseded and a correction posted on #7954
- [NIT] SweepDots.swift:20 - 30 fps for the Reduce Motion pulse
- [NIT] SweepLogic.swift:76 - inset deviates from the CSS ring by 0.04 dot widths
- [NIT] sweep/main.swift:23 - placement rule not pinned (became a WARNING in iteration 3)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (main.swift:23, written by 560c488920; a code line, fixed normally)
- [WARNING] ios/Kosmos/SweepLogic.swift:3 - the interpretation of "our simple dots" is the line most likely overturned --> DEFERRED: by design; stated in the PR body with the revert
- [WARNING] ios/LogicTests/sweep/main.swift:23 - Reduce Motion no-scale rule, its opacity and the ring placement unpinned --> FIXED: pinned; a page with the rule changed fails 20/21 (13a1e80c4e)
- [NIT] SweepDots.swift:33 - updatesFrequently dropped with Reduce Motion though the dots pulse --> fixed (13a1e80c4e)
- [NIT] SweepDots.swift:24 - off-centre in a non-square box (moot, frame is square)
- [NIT] plan:21 - "three sites" stale --> fixed (13a1e80c4e)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
**Duplicates of prior findings:** 1 (the allow screen's orb, iteration 2, DEFERRED; the reviewer asked for no change)
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 0 | 6.0 | BLOCKER | initial-validation: yarn test | BRANCH | 4 load-induced failures | DEFERRED | 57/57 alone; 6j full suite 0 fail |
| 1 | 1 | WARNING | ios/Kosmos/AgentsView.swift:389 | BRANCH | .connecting kept the orb | FIXED | 560c488920 |
| 2 | 1 | WARNING | ios/LogicTests/sweep/main.swift:3 | BRANCH | no read of the board | FIXED | 560c488920 |
| 3 | 1 | WARNING | ios/LogicTests/sweep/main.swift:17 | BRANCH | fall edge unchecked | FIXED | 560c488920 |
| 4 | 1 | WARNING | ios/Kosmos/SettingsView.swift:134 | BRANCH | wrong words on a non-connect read | FIXED | 560c488920 |
| 5 | 1 | WARNING | ios/Kosmos/SweepLogic.swift:3 | BRANCH | comment implied live board | FIXED | 560c488920 |
| 6 | 2 | WARNING | ios/Kosmos/AgentsView.swift:392 | BRANCH | allow screen keeps orb | DEFERRED | different wait; on card |
| 7 | 2 | WARNING | ios/Kosmos/AgentsView.swift:429 | BRANCH | words differ from Projects | DEFERRED | by design; card corrected |
| 8 | 3 | WARNING | ios/Kosmos/SweepLogic.swift:3 | BRANCH | interpretation risk | DEFERRED | PR body + revert line |
| 9 | 3 | WARNING | ios/LogicTests/sweep/main.swift:23 | SELF | three CSS facts unpinned | FIXED | 13a1e80c4e |

### NITs (non-blocking, across all iterations)
- [NIT] SweepDots.swift:10 - 20 pt default and Dynamic Type growth (iteration 1)
- [NIT] SweepDots.swift:20 - 30 fps for the Reduce Motion pulse (iteration 2)
- [NIT] SweepLogic.swift:76 - ring inset differs from the CSS by 0.04 dot widths (iterations 2, 4)
- [NIT] SweepDots.swift:24 - centring assumes a square box (iteration 3)

### Strengths (across all iterations)
- Timing traced against the CSS by three reviewers: negative delays equal t - 0.15i, easing per keyframe segment, calmPulse in unison (iterations 1-4)
- Mutants go red: counter-clockwise, moved rest edge, changed constants, removed inset, changed Reduce Motion rule (iterations 1, 3)
- Wired twice: ios.yml step gated on the verdict, and ios.board-parity-7084 discovers the suite from its repoText read (iterations 2-4)
