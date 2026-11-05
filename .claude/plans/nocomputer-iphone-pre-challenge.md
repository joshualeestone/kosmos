---
pre_challenge: true
method: challenge-loop
branch: nocomputer-iphone
diff_hash: b5752080ab3f02745396aeeeae0359e190de044c056fa14a05199954f1ef417e
validation: passed
subdir_audit: passed
timestamp: 2026-11-05T20:42:12Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes
**Total findings:** 29 (0 BLOCKERs, 21 WARNINGs, 3 CONVENTIONs, 5 NITs acted on; further NITs listed below)
**Fixed:** 15 | **Deferred:** 6 (plus 8 duplicates of deferred items) | **Asked (awaiting user):** 0

Final validation: 27362 tests, 26952 pass, 0 fail, 410 skipped, on 3857c2a1af; all 12 iOS logic suites pass.
Simulator, both arms, on the final code: signed out, Tasks and Projects show the connection screen with their own
signed-out line and Settings its sentence; the sample live board shows all three tabs unchanged.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 0 of the above (no loop commit existed yet)
- [WARNING] TasksView.swift:23 — Tasks replaced a kept list with BoardStates when a let-in Mac stopped answering --> FIXED (a9507ebb5a)
- [WARNING] TasksView.swift:39 — task links and the New task sheet inside the swapped branch --> FIXED (a9507ebb5a)
- [WARNING] TasksView.swift:23 / ProjectsView.swift:845 — two boardNotThere rules, untested --> FIXED (a9507ebb5a, Board.showsConnectionScreen + tests)
- [WARNING] SettingsView.swift:311 — Task.yield is empirical; comment overclaimed the mechanism --> FIXED (a9507ebb5a, comment states only the measurement)
- [CONVENTION] SignInLogic.swift:359 — refusal inserted under cleanMessage's doc comment --> FIXED (a9507ebb5a)
- [NIT] SignInLogic.swift:59 — sentence capitalises "iPhone" to "IPhone"
- [NIT] main.swift:4944 — "X." pins a placeholder

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 1 NIT acted on
**Self-generated:** 1 of the above (the Settings comment's "reading reading", written in a9507ebb5a)
**Duplicates of prior findings:** 1 (Settings yield)
- [WARNING] ProjectsView.swift:831 — hasList hard-coded false --> FIXED (f67f0ca6fc)
- [WARNING] TasksView.swift:30 — indentation of the new Group --> FIXED (f67f0ca6fc)
- [WARNING] TasksView.swift:35 — BoardStates hides the Mac switcher --> DEFERRED: identical to the Agents tab, and with no computer there is nothing to switch to
- [NIT] SettingsView.swift comment typo --> FIXED (f67f0ca6fc), stray blank line --> FIXED

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings:** 1 (Settings yield)
- [WARNING] AgentsView.swift:387 — signed-out line says "Your agents" on Tasks and Projects --> FIXED (5f90979b0a, signedOutDetail per tab)
- [WARNING] TasksView.swift:33 — a kept session with the Mac asleep still waited for good --> FIXED (5f90979b0a, rule keyed on phase and list only)
- [WARNING] ProjectsView.swift:831 — sticky .failed flashed "cannot read" on Try again --> FIXED (5f90979b0a, sentence only while live)
- [WARNING] main.swift:4898 — phase mapping untested and duplicated --> FIXED (5f90979b0a, Phase.liveOrStarting tested over all 14 phases)
- [CONVENTION] nocomputer-iphone.md — plan did not match the code --> FIXED (5f90979b0a)
- [NIT] tests placed inside another group --> FIXED (5f90979b0a, own do-blocks)
- [NIT] refusal truncation then a stop; [NIT] confirm a pushed page survives the switch; [NIT] duplicated liveOrStarting --> FIXED with the warning above

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT acted on
**Self-generated:** 1 of the above (blank lines from 5f90979b0a)
**Duplicates of prior findings:** 1 (Settings yield)
- [WARNING] ProjectsView.swift:834 — a failed read during .starting shows the wait --> DEFERRED: .starting is transient and resolves to live (the sentence) or another phase (the connection screen); showing the sentence there is the flash iteration 3 removed
- [WARNING] TasksView.swift:25 — view wiring not unit-tested --> DEFERRED: SwiftUI wiring here has no unit harness; covered by the simulator arms
- [NIT] stray blank lines --> FIXED (7bec1ab1a4)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs acted on
**Self-generated:** 1 of the above (the rule and test name claiming the Agents rule, from 5f90979b0a)
**Duplicates of prior findings:** 1 (Settings yield)
- [WARNING] BoardLogic.swift:15 — a kept list stayed in every phase, Agents keeps it in four --> FIXED (3857c2a1af, Phase.keepsList, also used by AgentsView.shownList)
- [WARNING] ProjectsView.swift:831 — toolbar (sort, +) shows above the signed-out screen --> DEFERRED: predates this branch (the cannot-read branch had it), and it is layout, left for Josh's walkthrough
- [NIT] loadList comment out of date --> FIXED (3857c2a1af); [NIT] pass the real list state --> FIXED (3857c2a1af)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs (4 warnings raised, all duplicates of deferred items)
**Self-generated:** 0
**Duplicates of prior findings:** 4 (Settings yield, Mac switcher, failed read while starting, wiring tests)
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | TasksView.swift:23 | BRANCH | kept list replaced when a Mac stops answering | FIXED | a9507ebb5a |
| 2 | 1 | WARNING | TasksView.swift:39 | BRANCH | links and sheet inside the branch | FIXED | a9507ebb5a |
| 3 | 1 | WARNING | TasksView.swift:23 | BRANCH | two untested rules | FIXED | a9507ebb5a |
| 4 | 1 | WARNING | SettingsView.swift:311 | BRANCH | yield comment overclaimed | FIXED | a9507ebb5a |
| 5 | 1 | CONVENTION | SignInLogic.swift:359 | BRANCH | doc comment misplaced | FIXED | a9507ebb5a |
| 6 | 2 | WARNING | ProjectsView.swift:831 | SELF | hasList hard-coded | FIXED | f67f0ca6fc |
| 7 | 2 | WARNING | TasksView.swift:30 | SELF | indentation | FIXED | f67f0ca6fc |
| 8 | 2 | WARNING | TasksView.swift:35 | BRANCH | Mac switcher hidden | DEFERRED | matches Agents |
| 9 | 3 | WARNING | AgentsView.swift:387 | BRANCH | signed-out line names agents | FIXED | 5f90979b0a |
| 10 | 3 | WARNING | TasksView.swift:33 | SELF | Mac asleep waits for good | FIXED | 5f90979b0a |
| 11 | 3 | WARNING | ProjectsView.swift:831 | SELF | cannot-read flash on Try again | FIXED | 5f90979b0a |
| 12 | 3 | WARNING | main.swift:4898 | SELF | phase mapping untested | FIXED | 5f90979b0a |
| 13 | 3 | CONVENTION | nocomputer-iphone.md | BRANCH | plan out of date | FIXED | 5f90979b0a |
| 14 | 4 | WARNING | ProjectsView.swift:834 | SELF | failed read while starting | DEFERRED | transient phase |
| 15 | 4 | WARNING | TasksView.swift:25 | SELF | wiring untested | DEFERRED | simulator arms |
| 16 | 5 | WARNING | BoardLogic.swift:15 | SELF | list kept in every phase | FIXED | 3857c2a1af |
| 17 | 5 | WARNING | ProjectsView.swift:831 | BRANCH | toolbar above signed-out screen | DEFERRED | pre-existing layout |
| 18 | 1-6 | WARNING | SettingsView.swift:311 | BRANCH | Task.yield is timing, not a guarantee | DEFERRED | measured both ways; card names it as the weakest premise |

### NITs (non-blocking, across all iterations)
- [NIT] SignInLogic.swift:59 — sentence capitalises a lowercase brand word (iteration 1, 3, 4)
- [NIT] SignInLogic.swift:362 — a refusal cut at 200 characters then gets a stop (iteration 3, 4, 5)
- [NIT] TasksView.swift:11 / ProjectsView.swift:669 — openBoard defaults to a no-op (iteration 2, 4, 6)
- [NIT] main.swift — the phase list is written out by hand (iteration 5)

### Strengths (across all iterations)
- One SignIn.refusal helper at every refusal site, with real strings and controls (iterations 1 to 6)
- One phase rule, Phase.keepsList / liveOrStarting, shared by Agents, Tasks and Projects and tested over all 14 phases (iterations 5, 6)
- BoardStates keeps its old line as the default, so Agents and Today are unchanged (iterations 3, 4)
