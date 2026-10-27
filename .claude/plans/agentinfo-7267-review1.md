# agentinfo-7267 review 1 (blind, CTO lens and design)

Reviewed: 7494e0d6b5055e54cc53fff200fbdd3ff2d62e2a

Counts: 0 BLOCKER, 5 WARNING, 4 NIT

## Findings

### [WARNING] ios/Kosmos/AgentInfoLogic.swift:52: modelLine decides "not running" from `running`, the board decides it from the state, and they differ for a live pane in state `stopped`

The board's modelLine uses `notRunning = cardStOf(a).pres === 'off'`, which is state `stopped` (plus a failed restart, `CARD_ST_FAILED_RESTART`). server.js:7114 sets `running: true` on every live-pane row, including a pane whose state is `stopped` (the comment there says so: "TRUE FOR A `stopped` PANE TOO"). For that same row, `plannedFor` (server.js:6991) fills `plannedModelName` *because* the state is stopped, so the row carries both readings.
Failure: an agent whose pane is up but shows `stopped`, with transcript model Opus 5 and job model Haiku 4.5. The board card says "Claude Haiku 4.5". This page says "Claude Opus 5". That is the card-vs-detail disagreement the board comment at web/index.html:22329 describes. The same wrong input gates the Gemini "(set to X)" arm. The other direction is wrong too: an offline row in state `unknown` or `needs_trust` has `running: false` but presence `unsure` on the board. The test "stopped: what it will start on" only uses running:false, so it cannot see this.
Fix: parse `state` (and `disruption.failed`) and derive `notRunning` the way cardStOf does: state == "stopped", or state == "needs_you" with disruption.failed == true. Add a case for a running:true, state:"stopped" row that has both names.

### [WARNING] ios/Kosmos/AgentInfoView.swift:243: a refresh can move the name the Save compares against, so a role-only Save renames the agent back (the #4421 bug the board already fixed)

`profileSaveRequest` sends `displayName` when `nameText != details.name`. `details` is replaced on every load(), but `nameText` is only refilled when nothing was changed.
Failure: the person edits the role. The agent is renamed on the computer. A pull-to-refresh (or the post-save load) brings `details.name` = new while `nameText` still holds the old name. Save then sends `displayName: <old>` and silently renames the agent back. Role has the same issue: if they edited only the name and the role changed elsewhere, the role box keeps the stale role and Save writes it back. The board avoids this by comparing against what the box was *filled with* (`renameBox.dataset.shown`, web/index.html ~51404).
Fix: keep `nameShown`/`roleShown` as the values the boxes were last filled with. Compute `changed` from those, and pass `nameShown` as `shownName`. Only send `role` when it differs from `roleShown`, or accept the role overwrite as the board does, but say which you chose.

### [WARNING] ios/Kosmos/AgentInfoView.swift:259: "Saved." drops the board's restart sentence, so the phone says done while the running agent still answers to its old name

The PUT answers `renamed` ({changed, ok, was, because}) and `reports`. The board reads both (web/index.html ~51440): "Saved. <Old> will not answer to <New> until you restart it.", "Saved. It will know its new name when it next starts.", or "Saved here, but <because>.". iOS ignores the body and always says "Saved.".
Failure: the operator renames Bob to Scarlet from the phone. The phone says "Saved." and Scarlet keeps introducing herself as Bob. This is the exact 2026-08-22 incident the board's sentence exists for. A partial failure (`renamed.ok == false`) also reads as a clean save.
Fix: return the `renamed` / `reports` verdict from `profileSaveResult` and port the board's sentences. The restart button is not on this page, so the running-agent arm can point at "More on your computer" (or at a restart route if one is wanted here). Add a test per arm.

### [WARNING] ios/Kosmos/AgentInfoLogic.swift:91: text over 80 characters reports "We could not reach your computer"

`profileSaveRequest` returns nil when the name or role is over 80. `throughMac` then returns nil, the status becomes 0, `.noAnswer` follows, and the person sees "We could not reach your computer, so it was not saved." The TextFields have no limit, and the Save button is only disabled for an empty name.
Failure: someone pastes a 100-character role and taps Save. They get a false network error and no hint that the text is too long. The board slices to 80 instead (`.slice(0, 80)`), and the server slices role itself.
Fix: clamp both fields to `profileFieldMax` as the person types (onChange prefix(80)), or slice like the board. Keep "could not build the request" separate from "no answer" so a nil request never reads as a network failure.

### [WARNING] ios/Kosmos/AgentInfoLogic.swift:45: the Account row prefers the folder slug (`label`) over the account's name and email, the reverse of the board

The board's `acctParenthetical` (web/index.html:22424) uses the order `name || email || "API key ending " + keyTail || label`. `label` is the slug fallback "for accounts that were never named". iOS uses `label ?? name` and never reads email or keyTail.
Failure: a named Claude account ("Work") or a Gemini key account shows its folder slug (for example "account-b") on the phone, while the board shows "Work" or "API key ending 1234". The sample data hides this because it puts "Work account" in `label`.
Fix: port acctParenthetical exactly (name, email, keyTail sentence, label), pin its four rungs in the suite, and add the board phrase to the pinned-phrases loop.

### [NIT] ios/Kosmos/AgentInfoLogic.swift:161: a refusal with only `error` (404 no agent, 500 could not reach) says "It could not be done just now."

The route answers `{ error: 'we could not reach this agent' }` at 500 and `{ error: 'no agent by that name' }` at 404, with no `delivery`. The phone drops the route's own sentence. Being safe on `d == nil` is right; the board says "Asked it to…" there, which is the board's bug.
Fix: fall back to `sentence(obj["error"])` before the generic line.

### [NIT] ios/Kosmos/AgentInfoView.swift:110: the save and Fresh start result lines are not announced to VoiceOver

The board marks `d-role-msg`, `d-compact-msg` and `d-clear-msg` as `role="status" aria-live="polite"`. On iOS the line appears silently below the buttons, so a VoiceOver user who pressed Save or confirmed Clear hears nothing.
Fix: post `UIAccessibility.post(notification: .announcement, argument: text)` when saveLine or freshLine is set (the room already has a `say` helper).

### [NIT] ios/Kosmos/AgentInfoView.swift:158: the runner mark is a fixed 22pt and does not scale with Dynamic Type

At accessibility sizes (small-light-ai-a11y.png) the model text is roughly 3x larger and the mark stays small beside it. The 72pt avatar is also fixed, which is acceptable for a face.
Fix: `@ScaledMetric var markSize: CGFloat = 22`.

### [NIT] /Users/agent1/work/workers/monalisa/ios-design-2026-10-26/7267/: the shots predate the reviewed head

All twelve PNGs are dated 19:35:45. Commit 7494e0d (19:36:06) changed the Memory row from "45% full" to "45%", and the AI shots still show "45% full".
Fix: retake the AI shots at the head before the design sign-off, so the shots show what ships.

## Checked and found clean

- Card: the "i" button now pushes AgentInfoView, which shows no conversation. The Profile | AI Settings segmented control is present and styled in light and dark at both sizes (read all twelve shots). The a11y shots wrap rather than clip, and the segmented labels stay legible.
- modelLine: every other arm matches web/index.html:22348-22370 word for word: Qwen on codex, the codex `^(gpt|openai|codex)\b` regex, gemini/grok/antigravity/muse fallbacks, neverRecorded vs "Unknown Model", the Claude prefix guard. A paneless `runner: null` falls to Claude on both sides.
- Routes (server.js): PUT /profile (16924) takes role/displayName, trims and caps the name at 80, refuses a clash with `{error}` at 400, and returns 200 JSON. GET /instructions (20523) returns `{exists,text}`. GET /skills (8510) returns `{ok,skills:[{name}]}` or `{ok:false,because}`. POST /compact and /clear (9957) take no body, return 409 with delivery.could_not (Muse included), and 200 otherwise. Parsers match these shapes.
- Remote step-up: none of /api/status, /profile, /instructions, /skills, /compact or /clear is in REMOTE_STEP_UP_EXACT or REMOTE_STEP_UP_PATTERNS (server.js:4802-4854). Accept: application/json is set on every request, so the gate's sign-in page at 200 is read as no answer, never as saved (tested).
- Board.isAgentSession guards every built request: profileSaveRequest, agentRequest, and freshRequest through agentRequest. The session reaches the URL only after that check, so it needs no percent-encoding.
- Only-changed name: an unchanged name is not sent (tested). An empty name is refused client-side, and the server also drops it.
- Fresh start confirm words: the title, the body and the go button match web/index.html:59530-59542 exactly. The result sentences match memoryCommand, and the suite pins them against the page.
- Fresh start shows the board's two colon labels and footer. Clear has the destructive role. Restart is deferred to "More on your computer", whose footer says so.
- SwiftUI: the hidden NavigationLink sits on the chat body inside the existing NavigationView stacks (AgentsView, TodayView, TasksView, and the room's own hidden-link push, which uses the same pattern). `.toolbar(.hidden, for: .tabBar)` works on iOS 16 (the deployment target is 16.0). The confirmationDialog binding clears `asking`.
- Debug-only code: AgentInfoView.sample and applySample, and the ChatView auto-open, are all inside `#if DEBUG`. Every reference to them is inside DEBUG blocks, so a Release build cannot reach them.
- Tests: run-agentinfo.sh ran here and printed `VERDICT: PASS 51/51`. The binary exits 1 on any failure. The runner uses set -euo pipefail. The CI step uses pipefail, tee and `grep -q '^VERDICT: PASS'`, so a missing verdict fails. The suite reads web/index.html through `appendingPathComponent("web/index.html")`, so ios.board-parity-7084.test.js discovers it and also runs it in the node suite whenever web/ changes, which covers ios.yml's path filter.
