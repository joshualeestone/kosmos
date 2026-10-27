# kosmos#7267 review 5 (blind, CTO lens and design)

Reviewed: c27f90ed21b6828e6115d3caf45e952e99ca72e6

Counts: 0 BLOCKER, 1 WARNING, 3 NIT

## Findings

### [WARNING] ios/Kosmos/AgentInfoView.swift:212: "More on your computer's board" reopens the duplicate chat the card removed

`moreRow` calls `openOnBoard`, which every ChatView caller (AgentsView.swift:34, RoomView.swift:157, TodayView.swift:79, TasksView.swift:118) builds from `client.chatURL(for:)`. That is `PushBridge.boardURL`: `/?tab=detail&agent=<session>` with no section. The board's boot handler calls `openDetail(WANT_AGENT)` (web/index.html:44683), and `openDetail` lands on `detailGo(section || 'talk')` (web/index.html:44623), the Direct Message section.

Failure scenario: the person opens "i", goes to AI Settings, reads the footer "Change the model or the account it runs on, restart it, or remove it." and taps the row. They land on the board's copy of the conversation, the unstyled duplicate the card was filed to get rid of, and must find AI Settings themselves. The footer promises a place the row does not open.

Fix: give the row its own link that opens the board's AI Settings. The board reads `?sec=` only for `tab=settings` today (web/index.html:89681), so either pass a section through (`openDetail(WANT_AGENT, <known section from PARAMS.get('sec')>)`, with the phone sending `sec=model`), or, if the board change is out of scope, word the row and footer to say where it lands and how to get to AI Settings from there.

### [NIT] ios/Kosmos/AgentInfoView.swift:88: the Profile | AI Settings control is drawn for an agent whose page cannot show either

For a session `Board.isAgentSession` refuses (a found tmux session like "Angel"), the body ignores `part` and draws the same sentence and row in both positions, but the header still draws the segmented control. Failure scenario: tapping AI Settings changes nothing on screen, and VoiceOver announces a working two-segment control. Fix: draw the Picker only when `Board.isAgentSession(agent.session)`.

### [NIT] ios/Kosmos/AgentInfoView.swift:102: the Name and Role boxes can be typed in before anything has been read, and the typing then goes nowhere

`changed` is false while `details == nil`, so while `/api/status` has not answered (or answered without this agent) the boxes are empty and editable but Save never appears. When a later read or pull-to-refresh succeeds, `load()` fills them because `details == nil`, overwriting what was typed. Failure scenario: a slow or failed first read, the person types a name, nothing offers to save it, and it is then replaced. Fix: `.disabled(saving || details == nil)` on both TextFields (or show `unread` in their place until the first read).

### [NIT] ios/Kosmos/AgentInfoLogic.swift:179: one save-sentence order differs from the board

When the rename half answers `ok: false` and the reports half answers `could_not`, the board writes the rename sentence and then overwrites it with the reports one (`rep && !(ren && ren.changed)`, web/index.html around 51470), so the last word is the reports reason. The Swift returns the rename reason first and never reaches `reports`. Rare, and both sentences are true, but the comment says "word for word". Fix: test `reports` before the `ren.ok == false` arm when `ren.changed` is false, or note the difference.

## Checked and found clean

- Ran `run-agentinfo.sh`: `VERDICT: PASS 78/78`. The runner uses `set -euo pipefail`, the suite exits 1 on any failure and carries a premise check that the board page was read; the CI step pipes through `tee` under `pipefail` and greps `^VERDICT: PASS`, so a crash or a missing verdict fails the job. The runner script is mode 100755.
- The Xcode project uses `PBXFileSystemSynchronizedRootGroup` (4 hits), so the two new Swift files are built without a pbxproj change. The `Mark*` image sets exist for every runner `runnerMark` names. The dark screenshot shows the mark taking the foreground colour.
- Debug-only code: `ChatView.sampleInfoOpened`, the ChatView sample `onAppear`, `AgentInfoView.sample` and `applySample` all sit inside `#if DEBUG`, and `load()` reaches the sample only inside `#if DEBUG`. Nothing sample-related is reachable in Release.
- `Board.isAgentSession` covers every agent path: `load()` returns early, and `profileSaveRequest`, `agentRequest` (instructions, skills) and `freshRequest` each guard on it. `/api/status` and `/api/roles` carry no session. The deep link for a refused session falls back to the board home (`boardURL`).
- Remote session: none of `PUT /api/agent/<n>/profile`, `POST .../compact|clear`, `GET .../instructions|skills`, `GET /api/roles` is in `REMOTE_STEP_UP_EXACT` or `REMOTE_STEP_UP_PATTERNS` (server.js:4801-4864), which matches the file's header comment.
- Profile route parity (server.js:16924): role is cut to 80 and displayName trimmed and cut to 80, and the Swift `capped` matches in UTF-16 units. The name is sent only when edited (board #4421) and reportsTo is never sent, so a one-agent board cannot clear it. A role-box prefill from `roleLine` matches the board's `d-role` fill (web/index.html:44554).
- `modelLine`, `cardStOf` presence off (`stopped` is the only `pres: 'off'` state in CARD_ST, plus `CARD_ST_FAILED_RESTART`), `acctParenthetical` and `roleLine`/`learnRoleTitles` read line by line against web/index.html. They match, and the suite pins the board's source lines.
- `parseInstructions` matches `engine/instructions.js read`: `exists:false` plus `editable` is a missing file, and otherwise it cannot be read. `parseSkills` matches `engine/skills.js list` (`{ok, skills:[{key,name}]}`, `ok:false` on a read error).
- Compact/Clear match the server's answers: a Muse runner gets 409 with `delivery.could_not.because` (said), an unknown agent gets 404 `{error}` (said through `sentence`), and a thrown deliver gets 500 `{error}`. Stricter than the board on a body with no delivery (never claims it went), as the comment states. The confirm words match the board's `changeDialog` text. Clear uses the destructive role.
- Save flow: fields are disabled while saving. Refresh never overwrites a change. After a save the read refills from the server. A 200 that cannot be read is never called saved or failed. Saving, then announcing through `UIAccessibility.post` matches the board's aria-live.
- Navigation: the hidden `NavigationLink(isActive:)` sits on the ChatView (not in the toolbar) inside the stack-style `NavigationView` (iOS 16 target), and the tab bar is hidden on both pages. The DEBUG auto-open fires once per launch, so Back leaves the page. A sign-out (`chatEpoch`) pops ChatView and this page with it.
- Screenshots, light and dark at both sizes and with accessibility type: styled grouped page, segmented control under the header, no conversation repeated. The mark scales with `@ScaledMetric`. Rows wrap at accessibility sizes instead of clipping.
