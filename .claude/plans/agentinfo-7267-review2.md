# kosmos#7267 agent page (Profile | AI Settings): blind review 2

Reviewed: ac332d627fdb67ab76e29f027582cc2b5b5e60ff

Counts: 1 BLOCKER, 2 WARNING, 5 NIT

## Findings

### [BLOCKER] ios/Kosmos/AgentInfoLogic.swift:40: the role box is filled from the instruction file's parsed role, not the role the person chose
`parseAgentDetails` reads `row["role"]`. For a running agent that field is `identity.role` from `engine/status.js` (readIdentity), which is the line *parsed out of the instruction file*. The comment at engine/status.js ~7315 says so: "`role` deliberately still comes from the file below: the profile's own `role` field is what a person types into the detail panel, and the board already prefers that separately, one level up." The board fills `d-role` with `roleLine(a)` (web/index.html 44554, 22563): `a.profile.role` first, then the parsed `a.role`. The phone ignores `profile.role` entirely. (For a stopped, unseen row server.js 7320 sends `role: profile.role`, so the two kinds of row disagree as well.)

Failure scenarios:
1. Someone sets the role to "Bookkeeper" on the phone. The PUT stores `profile.role = "Bookkeeper"`. The read after the save gets `row.role`, which is still the file's parsed line. `changed` is false, so `fill(d)` puts the old role back in the box, and the header (`live.role`, which also comes from `row["role"]`) keeps the old one too. To the person the save looks like it was undone.
2. An agent has a chosen `profile.role` ("Project Manager") and a different parsed line ("writes copy"). The person changes only the name on the phone. `profileSaveRequest` always sends `role`, so it sends the parsed line, and the route writes it over the chosen role (`clean.role`) and into the managed block of the instruction file (`reports.tellAgent`). That is a silent data change the person never asked for.

Fix: in `parseAgentDetails`, read `text(profile?["role"]) ?? text(row["role"])` (the board's roleLine order). Draw the header's role line from `details?.role ?? live.role` as well. Add a test row whose `profile.role` differs from `role`, plus a check that pins the board's `const chosen = a.profile && a.profile.role;` the way the other phrases are pinned.

### [WARNING] ios/Kosmos/AgentInfoView.swift:276: text typed while a save is in flight is marked as saved, then overwritten
The text fields stay editable while `saving`. On `.saved`, `filledName`/`filledRole` are set from the *current* `nameText`/`roleText`, not from the values that were actually sent (`typed`, and the role captured in the request closure). Anything typed during the round trip therefore counts as already saved, so `changed` turns false. The `await load()` that follows then calls `fill(d)` and replaces the box with the server's value. The extra typing disappears with no Save button and no sentence. The comment on line 275 ("What was sent is now what the boxes hold") is only true when nobody types during the request.

Fix: capture the trimmed and capped name and role that are sent, set `filledName`/`filledRole` to those, and in `load()` refill only when `!changed`. Or the simpler fix: `.disabled(saving)` on both TextFields.

### [WARNING] ios/Kosmos/AgentInfoLogic.swift:160: an instruction file that cannot be read shows as "No instructions yet."
`GET /api/agent/<n>/instructions` answers `exists: false` in two cases (engine/instructions.js `read`, 547 to 573). One is a missing file (`editable: true`). The other is a file that is there but cannot be shown: a symlink, too large, not UTF-8 (`editable: false`, with `because`). `parseInstructions` maps every `exists == false` to `""`, so the page says "No instructions yet." about an agent that has instructions. A wrong claim of that kind is the failure the board's structured `editable` field was added to prevent.

Fix: return `""` only when `exists == false && editable == true`. Otherwise return nil, which shows "We cannot read this right now.", or surface `because`. Add a test case for `{"exists":false,"editable":false,"because":"..."}`.

### [NIT] ios/Kosmos/AgentInfoLogic.swift:52: "stopped" misses the board's other pres:'off' state
The board's modelLine decides `notRunning` from `cardStOf(a).pres === 'off'`. Besides `state == "stopped"`, that is also true for `CARD_ST_FAILED_RESTART`: `state === 'needs_you'` with `disruption.failed === true` (web/index.html 21915, 21916). For an agent whose restart failed, the phone names the transcript model while the board names the planned one. Fix: set `stopped` also when `state == "needs_you"` and `disruption.failed == true`, and add a test.

### [NIT] ios/Kosmos/AgentInfoView.swift:144: skills are listed with `id: \.self` over display names
engine/skills.js `list` sets `name` to `meta.title || meta.name || ent.name`, so two skill folders can share a title. Duplicate ids in a `ForEach` give undefined row reuse, and SwiftUI logs a warning. Fix: parse `key` too and use it as the id.

### [NIT] ios/Kosmos/AgentInfoLogic.swift:96: the 80 cap counts grapheme clusters, but the route counts UTF-16 units
Swift's `prefix(80)`, and the onChange caps in the view, count Characters. server.js does `.trim().slice(0, 80)` in UTF-16 code units. A name with emoji or other non-BMP characters can therefore be cut further by the server, and in the worst case split through a surrogate pair. The after-save sentence ("X will not answer to <typed>") then names a longer name than the one stored. The later read corrects the box. Fix: cap by `utf16` count, keeping whole Characters.

### [NIT] ios/Kosmos/AgentInfoLogic.swift:127: an empty `renamed.was` does not fall back to the shown name
The board uses `ren.was || wasCalled`, so an empty string falls back. Swift uses `(ren?["was"] as? String) ?? before`, so an empty `was` stays empty and the "will not answer to" sentence is skipped. Fix: treat an empty `was` as missing.

### [NIT] ios/Kosmos/ChatView.swift:174: the Debug sample auto-open fires on every appearance of the chat
In a Debug run with `KOSMOS_SAMPLE_INFO` set, pressing Back from the info page makes the chat appear again, and 0.8 s later it pushes the page again, so the page cannot be left. This only affects the design-shot mode and never ships in Release (it is inside `#if DEBUG`). Fix: fire it once, for example with a static flag.

## Checked and found clean

- **modelLine parity** (read web/index.html 22312 to 22357 against Swift 57 to 70): the stopped-prefers-planned order, Qwen on codex, the codex regex, Gemini "(set to ...)" only while running, the Grok/Antigravity/Muse fallbacks, neverRecorded vs "Unknown Model", and the Claude prefix guard all match. Swift's trim-to-nil treats a whitespace-only name as missing where the board does not, which does not matter in practice.
- **acctParenthetical order** matches (name, email, "API key ending" plus keyTail, label), and a test pins the board's line.
- **Profile save sentences** (read web/index.html 51394 to 51480): the both-names restart sentence appears only when the file changed, the agent is running, the name was edited and the old name differs; changed and running, and changed and stopped, match; `ren.ok == false` gives "Saved here, but". Reports told plus running is folded into one sentence because there is no restart modal on the phone. displayName is sent only when the name was edited (#4421), and reportsTo is never sent, so it can never clear a reporting line (the board's hidden-field rule). The route's 400 `error` is shown as a sentence (#5957).
- **memoryCommand parity**: the confirm title, small text and go words are word for word (pinned by tests); the could_not reason; the paneNote or the default sentence. Two deliberate differences, both justified in comments: a body with no delivery is not reported as sent, and a refusal before delivery uses the route's own error.
- **Routes and remote session**: server.js needsRemoteStepUp (4802 to 4853). None of PUT /profile, POST /compact, POST /clear, or GET /instructions and /skills is in REMOTE_STEP_UP_EXACT or PATTERNS, so a phone session may use all of them without a step-up, as the header comment claims. Muse compact/clear answers a 409 with a could_not delivery, which shows its reason.
- **Board.isAgentSession**: profileSaveRequest, agentRequest (instructions, skills) and freshRequest all go through it; /api/status takes no session. The session is a lowercase slug, so the unescaped path is safe.
- **Navigation**: the hidden `NavigationLink(isActive:)` sits in `.background` of the chat body inside the parent NavigationView (AgentsView, TodayView, TasksView, and RoomView's own hidden link), which is the pattern RoomView already uses. `.toolbar(.hidden, for: .tabBar)` is set on the page (iOS 16 is the deployment target). ChatView's onDisappear/onAppear when the page is pushed on top keeps the draft (it refills only an empty box) and restarts reading.
- **Accessibility**: the info button's label names the agent; the save and fresh-start results are announced (the board's aria-live); value rows and the memory row are combined; the avatar and mark are hidden from VoiceOver. Screenshots (*-a11y.png) show the header, rows and labels scaling at accessibility-large and wrapping without clipping. The segmented control's labels stay at system size, which is UIKit's own behaviour.
- **Dark mode**: large-dark-ai.png shows Palette colours throughout: readable secondary text, the memory band green, Clear in the danger colour, and the Claude mark tinted primary.
- **Debug-only code**: `AgentInfoView.sample`, `applySample` and ChatView's auto-open are all inside `#if DEBUG`; `load()` checks the sample only inside `#if DEBUG`.
- **Tests**: ran `run-agentinfo.sh` and got `VERDICT: PASS 67/67`. The runner uses `set -euo pipefail` and exits 1 on any failure. The CI step uses `set -o pipefail` with `tee` and also requires `^VERDICT: PASS`, so a crash or a missing verdict fails the step. Board-phrase pins make the suite fail if web/index.html drifts.
