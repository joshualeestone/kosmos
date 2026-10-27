# agentinfo-7267 review 3 (blind CTO lens and design)

Reviewed: 625975e54b5726fe00878eb8ebc0e9c4b2863ba7

Counts: 0 BLOCKER, 2 WARNING, 2 NIT

## Findings

### [WARNING] ios/Kosmos/AgentInfoLogic.swift:42: the role field is filled with the raw parsed line, not the board's roleLine, so any phone Save writes a lower-case role into the record
The board prefills `d-role` with `roleLine(a, ROLE_TITLES)` (web/index.html 44554, function at 22543): `profile.role` first, else the parsed line looked up in the role catalogue (Josh's "proper capitals for both words" ruling), else the parsed line with its first character upper-cased. The phone uses `profile.role ?? row.role` verbatim. Engine-generated files read `You are **X**, a project manager.`, so `row.role` is "project manager".
Failure: the person renames an agent on the phone and leaves the role alone. `profileSaveRequest` always sends `role`, so the phone writes "project manager" into `profile.role`. From then on the board's `roleLine` returns the chosen value verbatim, and the board, its cards and the org view say "project manager" for good, where they said "Project Manager" before. The header on this page shows the lower-case line too, beside a board that capitalises it.
Fix: port `roleLine` (the first-character rule at least, and the catalogue lookup if the phone can read the roles route) and use it for both `fill` and the header. Add a test with a parsed lower-case role and a `boardPage.contains` pin on `parsed.charAt(0).toUpperCase() + parsed.slice(1)`.

### [WARNING] ios/Kosmos/AgentInfoView.swift:209: the footer promises "open its Terminal", which the page it opens refuses from a phone
"More on your computer" calls `openOnBoard`, which opens the board's agent page through the remote session. That page's Open Terminal handler returns early for `kplusRemote()` with `KPLUS_TERMINAL_ELSEWHERE` ("The Terminal window opens on the computer Kosmos runs on, not on this device.", web/index.html 20966 and the d-open-terminal handler). 
Failure: a person reads the footer, taps through for the Terminal, and is told it cannot be done here. That is a promise this page makes and the next page takes back.
Fix: drop "open its Terminal" from the footer ("Change the model or the account it runs on, restart it, or remove it."), or say it happens at the computer.

### [NIT] ios/Kosmos/AgentInfoLogic.swift:155: the reports-to "told" sentence says restart with no way to do it and no pointer to where
The rename arm was adapted for the phone ("You can restart it from your computer."), but the told arm keeps the board's "restart them to use it now", which on the board sits beside a pop-up Restart. On the phone there is no restart on this page, so the sentence asks for an action without saying where. A role-only save on a running agent hits this every time (`tellAgent` answers `told` on every save that sends a role).
Fix: add the same "You can restart it from your computer." tail, and adjust the test at main.swift:82 (the board-phrase pin can stay).

### [NIT] ios/Kosmos/AgentInfoView.swift:80: the segmented control does not grow with Dynamic Type
small-light-profile-a11y.png and small-light-ai-a11y.png: at accessibility-large every row, header and footer scales, while "Profile" and "AI Settings" stay at default size, the one control the card is about. This is the UISegmentedControl cap, not a layout bug, and the long-press large-content viewer still works, so it is legible; but on an SE the header (72pt avatar, title3 name, role) also takes about half the screen before any content at that size.
Fix: optional. At `typeSize.isAccessibilitySize`, consider a smaller avatar or none, so the switch and the first section sit above the fold. Leave the segmented control as the card asks for.

## Checked and found clean

- Tests: ran `run-agentinfo.sh` (CommandLineTools): `VERDICT: PASS 72/72`. The runner exits 1 on any failure, the board-premise check fails if `web/index.html` is not found, and the CI step uses `set -o pipefail` plus `grep -q '^VERDICT: PASS'`, so a crash before the verdict is red too.
- Remote permissions (read): `PUT /api/agent/<n>/profile`, `POST .../compact|clear`, `GET .../instructions`, `GET .../skills` are not in `REMOTE_STEP_UP_EXACT`/`_PATTERNS` (server.js 4802-4855) and have no `isRemoteRequest` refusal, so a phone session may do them, as the file header says. Switching model or account, Terminal and Remove stay on the computer.
- `Board.isAgentSession`: every request builder that puts a session in a path (`profileSaveRequest`, `agentRequest`, `freshRequest` via `agentRequest`) guards it; `parseAgentDetails` matches `sessionName` exactly and returns nil for an absent agent (tested).
- Profile PUT body: `role` always, `displayName` only when the box differs from what it was filled with, never `reportsTo` (the route clears reports-to on an empty string, server.js 16970, so omitting it is right). The route's clash check compares to `readIdentity`, so an unchanged name is never refused.
- Save flow: fields and Save disabled while saving; `typed` and `before` captured before the request; on success `filledName/filledRole` set to the trimmed sent values before the after-save `load()`, so `changed` is false and `fill` refills from the server; on refusal the typed text stays. UTF-16 cap matches the route's `slice(0, 80)` and cuts between whole characters (tested with emoji). Parsed roles are at most 60 units (engine/status.js 7671), so `onChange` capping never marks a fresh fill as changed.
- Role read: `profile.role` first, then `row.role`, as `roleLine`'s `chosen` (aside from the capitalisation in finding 1).
- Save sentences: compared with the d-save handler (web/index.html 51400-51520): rename with both names only while running and edited, changed/stopped arms, `ren.ok === false` arm, reports told/could_not. One deliberate difference: when `ren.ok` is false and reports is told, the board overwrites with "Saved." and the phone keeps "Saved here, but ..."; the phone's is the truer sentence, not raised.
- modelLine, acctParenthetical, cardStOf presence-off: line-by-line against web/index.html 22312-22425 and cardStOf; the crash-loop branch keeps its state's presence, which `stopped` already covers.
- Compact/Clear: the board shows them unconditionally with Restart (48447); dialog words and result sentences match `memoryCommand`; the d==nil error arm diverges on purpose and is commented; Muse gets the route's own could_not sentence.
- Instructions: `exists:false, editable:true` is "none yet"; `editable:false` is unreadable (engine/instructions.js 547-585). Skills `{ok, skills:[{key,name}]}` (engine/skills.js 77-95).
- SwiftUI: every ChatView host (AgentsView, TodayView, TasksView, RoomView inside ProjectsView) is inside a NavigationView, so the hidden `NavigationLink` on the chat body pushes; tab bar hidden on both pages; refresh preserves typing; announcements posted after save and after a fresh start.
- Debug-only: `sampleInfoOpened`, the auto-open `.onAppear`, `sample` and `applySample` are all inside `#if DEBUG`; nothing in Release reads `KOSMOS_SAMPLE_*`.
- Screenshots: light and dark, large and small, both parts read; dark tokens hold (no white fields, danger red legible, ring colour on 45%). No duplicate chat on the page.
