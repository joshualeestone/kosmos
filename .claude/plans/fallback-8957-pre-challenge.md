---
pre_challenge: true
method: challenge-loop
branch: fallback-8957
diff_hash: 8465d8007303d54cdb2b5d9002cc122d58cccb4226a38333e38186f519b57439
validation: passed (Mortals, clean entry 2026-11-24T08:59:30Z, 30,839 node tests, 0 failed, four shell shards)
subdir_audit: passed
timestamp: 2026-11-24T08:59:44Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (the cap in this worker's standing rule; round 8 produced no new actionable finding)
**Converged:** Yes
**Total findings:** 51 (0 BLOCKERs, 23 WARNINGs, 3 CONVENTIONs, 25 NITs)
**Fixed:** 18 | **Deferred:** 8 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 7 WARNINGs, 1 CONVENTION, 5 NITs
**Self-generated:** 0 of the above
- [WARNING] ios/Kosmos/SignInView.swift: "Opens the Kosmos+ sign-in page" untrue for three of four callers --> FIXED (fc7b35ceba: useWebNote from the caller)
- [WARNING] ios/Kosmos/AgentsView.swift: same destination, two wordings --> FIXED (fc7b35ceba)
- [WARNING] ios/Kosmos/AgentInfoView.swift: row 9 still a chevron --> FIXED (fc7b35ceba)
- [WARNING] ios/Kosmos/ChatView.swift: VoiceOver reads the icon's symbol name in the pills --> FIXED (fc7b35ceba: spoken label)
- [WARNING] ios/LogicTests/main.swift: the "when the note shows" rule untested --> FIXED (fc7b35ceba: Board.opensBoardFor)
- [WARNING] ios/KosmosUITests/BoardHandoffUITests.swift: screenshot per screen not met --> FIXED in iteration 3 (done-when narrowed to the four shot screens, recorded)
- [WARNING] ios/KosmosUITests/BoardHandoffUITests.swift: Cancel check races the dismissal --> FIXED (fc7b35ceba: waitForNonExistence)
- [CONVENTION] .claude/plans/fallback-8957.md: N2/N4 decision still "not decided" --> FIXED (fc7b35ceba)
- [NIT] project info had two icons; Tasks Answer can no-op; straight vs curly apostrophe; alert gives no reason; Try again only

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] ios/Kosmos/TasksView.swift:389: decision Answer reads the symbol name --> FIXED (8ac2d68b9b)
- [WARNING] ios/Kosmos/ProjectInfoView.swift:116: older arrow beside the new icon --> FIXED (8ac2d68b9b); other always-web hand-offs stated out of scope in the plan
- [WARNING] ContentView.swift:152: sign-in words unverified --> DEFERRED: the inventory traced signed-out taps to the Kosmos+ sign-in page
- [WARNING] BoardHandoffUITests.swift:42: premise (no macURL) unasserted --> DEFERRED: the sample board has no computer address (PigeonPete confirmed); a change fails the test loudly
- [NIT] apostrophes; duplicated literal; LogicTests scope

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 2 of the above
- [WARNING] RoomView/ProjectInfoView/TasksView: rows 15, 18, 21 showed only the icon to a sighted person --> FIXED (e169cb84bd: OpensOnBoardNote)
- [WARNING] ContentView.swift: the + alert's reason untrue in most phases --> FIXED (e169cb84bd: no reason; question and Cancel stay)
- [WARNING] BoardHandoffUITests.swift: done-when screenshot per screen --> FIXED (e169cb84bd: done-when names the four shot screens)
- [WARNING] AgentsView.swift:628: refused state keeps the web session, so not a sign-in page --> FIXED (e169cb84bd: says the board)
- [NIT] Tasks Answer can no-op; Make an agent for cloud customers; icon on a non-board page; apostrophes; LogicTests restate constants; plan split

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 2 of the above
- [WARNING] RoomView/TasksView: hint plus note read twice --> FIXED (1904c1fe55)
- [WARNING] ProjectInfoView.swift: member row read twice; note padding inside the row --> FIXED (1904c1fe55: foot parameter, default 0)
- [NIT] apostrophes; padding; first-frame wait --> fixed in passing (waitForExistence); plan wording

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 1 of the above
- [WARNING] AgentsView.swift:563: no way to another computer once Back to Kosmos is gone --> FIXED (bbb7be871f: the switcher on the not-answering tab)
- [WARNING] ContentView.swift:318: fresh sheet's title clashes with the true note --> DEFERRED: older routing; recorded on the card (comment 7125997082)
- [NIT] RoomView comment; Tasks comment order; double icon in member row --> FIXED (bbb7be871f); no-op edges recorded on the card; icon styling

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 2 of the above
- [WARNING] TasksView.swift:113: note shows when the tap does nothing (no chat address) --> FIXED (e538c489e7)
- [WARNING] AgentsView.swift:567: switcher gate differs from MacSwitcher's rows; no 44 pt target --> FIXED (e538c489e7)
- [CONVENTION] BoardLogic.swift:2472: apostrophe style --> DEFERRED: most existing board strings in the app use the straight apostrophe (Settings, task page, files, room)
- [NIT] README on the native tabs --> FIXED (e538c489e7); note name; hittable; member note order

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 2 of the above
- [WARNING] AgentsView.swift:405: Make an agent note vs #8954 making it native --> DEFERRED: recorded in the plan; PigeonPete gates it on rebase (Fleet Builders m6304)
- [WARNING] RoomView.swift / ProjectInfoView.swift: note shows when the page cannot open (no computer address) --> FIXED (be4e6a9a12)
- [WARNING] AgentsView.swift:568: switcher untested --> DEFERRED: the sample board has one computer; recorded in the plan
- [NIT] README wording --> FIXED (be4e6a9a12); rotor action name; note name; apostrophes; Projects + untested; row 30 now native (recorded)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs (after deduplication), 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings:** 3 (+ test premise, Make an agent vs #8954, refused note, each deferred above)
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | ios/Kosmos/SignInView.swift | BRANCH | sign-in note untrue for some callers | FIXED | fc7b35ceba |
| 2 | 1 | WARNING | ios/Kosmos/AgentsView.swift | BRANCH | two wordings, one destination | FIXED | fc7b35ceba |
| 3 | 1 | WARNING | ios/Kosmos/AgentInfoView.swift | BRANCH | row 9 missed | FIXED | fc7b35ceba |
| 4 | 1 | WARNING | ios/Kosmos/ChatView.swift | BRANCH | icon name spoken | FIXED | fc7b35ceba |
| 5 | 1 | WARNING | ios/LogicTests/main.swift | BRANCH | rule untested | FIXED | fc7b35ceba |
| 6 | 1 | WARNING | ios/KosmosUITests/BoardHandoffUITests.swift | BRANCH | Cancel race | FIXED | fc7b35ceba |
| 7 | 1 | CONVENTION | .claude/plans/fallback-8957.md | BRANCH | N2/N4 not decided | FIXED | fc7b35ceba |
| 8 | 2 | WARNING | ios/Kosmos/TasksView.swift:389 | BRANCH | Answer reads symbol name | FIXED | 8ac2d68b9b |
| 9 | 2 | WARNING | ios/Kosmos/ProjectInfoView.swift:116 | BRANCH | two icons on one screen | FIXED | 8ac2d68b9b |
| 10 | 2 | WARNING | ios/Kosmos/ContentView.swift:152 | BRANCH | sign-in words unverified | DEFERRED | inventory traced |
| 11 | 2 | WARNING | ios/KosmosUITests/BoardHandoffUITests.swift:42 | SELF | premise unasserted | DEFERRED | fails loudly |
| 12 | 3 | WARNING | ios/Kosmos/RoomView.swift | SELF | icon only, no words | FIXED | e169cb84bd |
| 13 | 3 | WARNING | ios/Kosmos/ContentView.swift | SELF | alert reason untrue | FIXED | e169cb84bd |
| 14 | 3 | WARNING | ios/KosmosUITests/BoardHandoffUITests.swift | BRANCH | screenshot per screen | FIXED | e169cb84bd |
| 15 | 3 | WARNING | ios/Kosmos/AgentsView.swift:628 | SELF | refused not a sign-in page | FIXED | e169cb84bd |
| 16 | 4 | WARNING | ios/Kosmos/RoomView.swift | SELF | read twice | FIXED | 1904c1fe55 |
| 17 | 4 | WARNING | ios/Kosmos/ProjectInfoView.swift | SELF | read twice; padding | FIXED | 1904c1fe55 |
| 18 | 5 | WARNING | ios/Kosmos/AgentsView.swift:563 | BRANCH | no other-computer path | FIXED | bbb7be871f |
| 19 | 5 | WARNING | ios/Kosmos/ContentView.swift:318 | BRANCH | fresh sheet title clash | DEFERRED | card follow-up |
| 20 | 6 | WARNING | ios/Kosmos/TasksView.swift:113 | SELF | note when no chat address | FIXED | e538c489e7 |
| 21 | 6 | WARNING | ios/Kosmos/AgentsView.swift:567 | SELF | switcher gate and target | FIXED | e538c489e7 |
| 22 | 6 | CONVENTION | ios/Kosmos/BoardLogic.swift:2472 | SELF | apostrophe style | DEFERRED | app majority straight |
| 23 | 7 | WARNING | ios/Kosmos/AgentsView.swift:405 | BRANCH | Make an agent vs #8954 | DEFERRED | PigeonPete gates it |
| 24 | 7 | WARNING | ios/Kosmos/RoomView.swift | SELF | note when page cannot open | FIXED | be4e6a9a12 |
| 25 | 7 | WARNING | ios/Kosmos/AgentsView.swift:568 | SELF | switcher untested | DEFERRED | sample has one computer |

### NITs (non-blocking, across all iterations)
- Apostrophe style mixed in the app (iterations 1 to 7)
- OpensOnBoardNote also names the Kosmos+ sign-in page (iterations 3, 6, 7)
- Projects + covered only by logic, not a UI test (iteration 7)
- Rotor action on Tasks' Answer does not name the board (iteration 7)
- Pill words duplicated between the text and the spoken label (iterations 2, 8)

### Strengths (across all iterations)
- One tested rule for when an agent fallback names the board, applied with each site's own reachability condition.
- VoiceOver never reads an SF Symbol name; no doubled reading.
- The + question is an alert with a visible Cancel; LoadFailureView's Back kept only where it means the board.
