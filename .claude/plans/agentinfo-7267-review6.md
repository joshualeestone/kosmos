# kosmos#7267 review 6 (blind, CTO lens and design)

Reviewed: 90b925ac677f3421d3da99dfd355909af5415df6

Counts: 0 BLOCKER, 0 WARNING, 3 NIT

## Findings

### [NIT] ios/Kosmos/AgentInfoView.swift:43-47 and 234: the board-only page's row footer promises AI Settings the link cannot reach
Failure scenario: an agent whose session the phone will not request (a found tmux session such as "Angel") gets the page with "Angel's settings can be changed on your computer's board." plus `moreRow`, whose footer says "Its AI Settings there change the model or the account it runs on, restart it, or remove it." The row calls `openOnBoard`, which goes through `chatURL`, and `PushBridge.boardURL` adds `?tab=detail&agent=` only for an `isAgentSession` name, so the board opens on its home page and `withBoardSection` returns nil. The person lands on the board home, not on that agent and not on AI Settings, which is not what the footer said.
Fix: for the board-only case, either give `moreRow` a footer that says the board opens on its home page (find the agent there), or leave the footer off on that branch.

### [NIT] ios/Kosmos/AgentInfoView.swift:102-121: a failed status read leaves the Name and Role boxes empty and disabled with nothing saying why
Failure scenario: `/api/status` fails or answers something `parseAgentDetails` cannot read (the gate's sign-in page, a timeout). `details` stays nil, so both TextFields are disabled and empty, showing only their placeholders ("What you call them"), while Instructions and Skills further down say "We cannot read this right now." The top of the Profile tab reads as an agent with no name and no role instead of as a read that failed.
Fix: when `details == nil && readFailed`, show the `unread` line in the Name section (or above the two fields) instead of empty disabled boxes.

### [NIT] Screenshots in ios-design-2026-10-26/7267 do not match HEAD's copy
Failure scenario: `large-dark-ai.png` shows the row footer "Its page there opens on the conversation. AI Settings, beside it, changes the model or the account it runs on, restarts it, or removes it." HEAD (AgentInfoView.swift:234) says "Its AI Settings there change the model or the account it runs on, restart it, or remove it." So the design evidence predates the #7280 change and does not show the copy that ships.
Fix: retake the AI Settings shots (light, dark, a11y) from HEAD before the design sign-off cites them.

## Checked and found clean

- Tests run here: `run-agentinfo.sh` printed VERDICT: PASS 83/83, and `run.sh` printed VERDICT: PASS 1283/1283. The suite can fail: every check counts toward a FAIL verdict and exit 1, it reads web/index.html behind a premise check (count > 100000), and it pins the board's phrases with `contains`.
- CI: ios.yml has a new step that runs `run-agentinfo.sh` under `pipefail` and greps `^VERDICT: PASS`. ios.board-parity-7084.test.js finds the suite on its own, because `appendingPathComponent("web/index.html")` matches READS_BOARD, so a change to the board's copy that breaks a pin goes red in the node suite even though ios.yml is path-filtered.
- boardSectionOnce one-shot (read): all five `openOnBoard` closures (RoomView:158, TasksView:117, TodayView:63/80, AgentsView:35) call `chatURL` synchronously on the same client the page was given (`store.clientForChat` is just `client`). The value is set and cleared around one synchronous call on the main actor. A notification tap goes through `PushBridge.boardURL` directly, never through `chatURL`, so the value cannot leak into it. TasksView:95 `chatURL(session:)` runs only while the value is nil. `withBoardSection` accepts only `profile` or `model`, only on a `tab=detail` link, and replaces any `sec` already there.
- isAgentSession (read): `agentRequest`, `profileSaveRequest` and `freshRequest` each guard on it, `load()` returns early for a non-agent session, and the segmented control and both parts are hidden for one. `statusRequest` and `/api/roles` are not agent paths.
- Remote (phone) session (read): `PUT /api/agent/<n>/profile`, `POST .../compact` and `.../clear`, and the instructions, skills and roles GETs are in neither REMOTE_STEP_UP_EXACT/PATTERNS nor REMOTE_NOT_ALLOWED (server.js 4758-4853), so a phone may call them, as the header comment claims. Restart, model, account and Terminal stay on the board.
- Save flow, compared with the board's d-save handler (web/index.html ~51390-51480): it sends `role` every time and `displayName` only when edited (compared against what the box was filled with, #4421), and it never sends `reportsTo`, which avoids the clear-on-empty the board guards against. The after-save sentences match word for word, including `ren.was || wasCalled`, the reports-to override only when `!ren.changed`, and told-while-stopped ending on "Saved.". The 80 cap is counted in UTF-16 units, cut between whole characters, which matches the route's `slice(0, 80)`. A 200 with a body this build cannot read is never reported as saved. Fields are disabled while saving and before the first read, and a refresh never overwrites typing (`!changed`).
- modelLine, presence off, roleLine and acctParenthetical match the board's modelLine (22312), cardStOf / CARD_ST_FAILED_RESTART, roleLine and the acct order. The agent page uses modelLine and not tileModelLine, which is correct by the board's own comment.
- Fresh start: the dialog words are the board's changeDialog text. `freshResult` treats a missing delivery as not sent and shows the route's own error. A Muse agent's 409 `could_not` shows its reason.
- Debug-only code: `ChatView.sampleInfoOpened`, the sample `.onAppear`, `AgentInfoView.sample` and `applySample` all sit inside `#if DEBUG`, and so does the call site in `load()`.
- SwiftUI (read): the hidden `NavigationLink(isActive:)` in `.background` follows the pattern TasksView, TodayView and TaskPageView already use under NavigationView (deployment target iOS 16, so `scrollContentBackground` and `toolbar(.hidden, for: .tabBar)` are available). `confirmationDialog(presenting:)` captures `which` before `asking` resets.
- Screenshots: light and dark, large and small, and the a11y sizes all show a styled page with the Profile | AI Settings segmented control and no duplicate chat, which meets the card's done-when (subject to the stale-copy NIT above).
