# agentinfo-7267 review 4 (blind, CTO lens and design)

Reviewed: 18c75cf097
Counts: 0 BLOCKER, 1 WARNING, 4 NIT

## Findings

### [WARNING] ios/Kosmos/AgentInfoView.swift:282-292 and :300-302: a session the phone will not address reads as "could not reach your computer"
Failure scenario: an agent whose session is not a plain lower-case name (a found tmux session such as `Angel`, or one with a dot; server.js claimantFor comments describe exactly these) passes the board's own gate but fails `Board.isAgentSession`. Every builder in AgentInfoLogic returns nil, `throughMac` returns nil, and the page says "We cannot read this right now." forever, Save says "We could not reach your computer, so it was not saved.", Compact or Clear says "We could not reach Kosmos." None of those is true: the computer answered nothing because nothing was asked. This is the same false "could not reach" that review 1 removed for the over-80 case (comment at AgentInfoLogic.swift:129).
Fix: check `Board.isAgentSession(agent.session)` once in the view; when false, draw the read-only parts from `live` and replace Save, Compact and Clear with one line such as "Change this agent on your computer." (and point at the More row). A test on `profileSaveRequest(session: "Angel")` already returns nil, so only the view's sentence needs the branch.

### [NIT] ios/Kosmos/AgentInfoLogic.swift:153: a 200 whose body cannot be read is reported as "We could not save that."
Failure scenario: the route answered 200 (the save happened) but the body did not parse (a proxy page, a truncated answer). The person is told it did not save; the boxes still show their typed values, so they retry, which is harmless, but the sentence is a claim the code cannot make either way. The comment says "never saved on a body this build cannot read", which is right, and the opposite claim is equally unproven.
Fix: on `status == 200, obj == nil` say "We could not tell whether that saved. Pull down to check." and keep the test at LogicTests/agentinfo/main.swift:98 pinned to the new words.

### [NIT] ios/Kosmos/AgentInfoView.swift:81-85: the segmented control does not grow with Dynamic Type
Measured on small-light-profile-a11y.png: the name, role and section headers scale to accessibility sizes, the Profile | AI Settings labels stay at the default size, and the avatar initial stays fixed (72pt, AgentAvatar). The control is the page's main navigation, so it is the one element a large-text reader most needs.
Fix: acceptable to leave (a stock segmented Picker is fixed-size); if wanted, at `typeSize.isAccessibilitySize` swap to two full-width buttons in a VStack, or scale the avatar with `@ScaledMetric` like `markSize`.

### [NIT] ios/Kosmos/AgentInfoView.swift:205: "More on your computer" opens the board in the phone's browser, not on the computer
The row calls `openOnBoard`, which opens `https://<mac>/?tab=detail&agent=<session>` on this device. "On your computer" reads as an instruction to go to the computer, and the footer's actions (model, account, restart, remove) are all available from that phone page (none is in REMOTE_STEP_UP_EXACT). The chat's own rows say "Open this chat on your computer's board" (ChatView.swift:404).
Fix: "More on your computer's board", matching the chat's wording.

### [NIT] ios/Kosmos/ChatView.swift:165: the info button's label uses `agent.name`, the page uses `live.name`
After a rename on the computer (or from this page), the button still announces the old name until the chat is reopened, while the page it opens titles the new one.
Fix: read the live roster row there too (`client.agents.first { $0.session == agent.session }?.name ?? agent.name`).

## Checked and found clean

- Tests run: `run-agentinfo.sh` prints `VERDICT: PASS 76/76` (measured). The runner exits 1 on any FAIL, prints a premise check that the board's page was read (so a missing web/index.html fails rather than vacuously passing the phrase checks), and the CI step uses `set -o pipefail` plus `grep -q '^VERDICT: PASS'`, so a crash before the verdict also fails the step (read).
- modelLine parity with web/index.html:22312: `notRunning` from `cardStOf(a).pres === 'off'`, which is only `stopped` and CARD_ST_FAILED_RESTART (needs_you + disruption.failed); crashLoop keeps its state's pres, so it is correctly not counted. Qwen, codex regex, gemini "(set to ...)" only while running, grok, antigravity, muse, neverRecorded and the Claude prefix all match (read).
- roleLine parity with web/index.html:22543: chosen `profile.role` first, catalogue lookup on the trimmed lower-cased parsed line, else first character upper-cased; learnRoleTitles' null-on-empty matched by `parseRoleTitles` (read). The board fills `d-role` with `roleLine(a, ROLE_TITLES)` (index.html:44554), so a name-only save persisting the normalised role is the board's behaviour too, not a phone-only drift.
- acctParenthetical order (name, email, "API key ending", label) matches index.html:22422 (read, and pinned by a test).
- Save body parity with the d-save handler (index.html ~51388): role trimmed always, `displayName` only when edited against the filled name (#4421), `reportsTo` never sent (so the phone cannot clear a reporting line). Server (server.js:16924) caps role and name at 80 with JS `slice`, which is UTF-16 units; `Board.capped` counts `utf16` and cuts on whole characters (read, tested with emoji).
- Save sentences: renamed-while-running with both names, changed running or stopped, partial `ren.ok false`, reports told only while running, could_not with reason, and `rep` ignored when the rename changed the file, all as the board (read).
- Fields locked while saving (`.disabled(saving)` on both boxes and the button); a refresh during a save cannot refill because `changed` is still true; after a save the filled values are set to what was sent before the read, so the read refills from the server rather than leaving a stale Save showing (read).
- Remote session: PUT profile, POST compact/clear, GET instructions/skills/roles/status are not in REMOTE_STEP_UP_EXACT or the patterns (server.js:4802-4854), so a phone session may do each (read). Muse's 409 `could_not` sentence surfaces through `freshResult` (server.js:9963).
- `Board.isAgentSession` guards every agent path: profileSaveRequest, agentRequest (instructions, skills) and freshRequest via agentRequest; /api/status and /api/roles carry no agent name (read). The session is interpolated into the URL unescaped, which is safe because the guard admits only `[a-z0-9_-]`.
- Instructions: `exists:false, editable:true` is "no file yet", `exists:false, editable:false` is unreadable (engine/instructions.js:551-566). Skills: `ok:false` (unreadable folder or 404) is never shown as "none" (engine/skills.js, server.js:8510).
- freshResult: `could_not` and a refusal before delivery say the route's words; a body with no `delivery` is not reported as sent. That last one departs from the board (memoryCommand says "Asked it to...") and the departure is justified in the code and test.
- Navigation: ChatView sits in AgentsView's NavigationView (.stack); the hidden NavigationLink on the chat's background pushes correctly (not inside the toolbar item); the tab bar stays hidden as it is on the chat (ChatView.swift:136). iOS 16 target covers `.scrollContentBackground`, `.toolbar(_:for:)` (read).
- Debug-only code: `AgentInfoView.sample`, `applySample`, `ChatView.sampleInfoOpened` and the sample onAppear are all inside `#if DEBUG`; Release has no reference to them (read).
- Light and dark: screenshots show the ground, rows, segmented control and danger red legible in both; VoiceOver: avatar hidden, name and role combined, key/value rows combined, results announced via `UIAccessibility.post(.announcement)` (read and looked).
