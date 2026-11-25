# boardsettings-8959: #8959 slice D1a, the computer's Automation settings, native

Card comment: https://github.com/joshualeestone/kosmos/issues/8959#issuecomment-7152306507

## Slice D1a plan (April, night shift, 21:5x CST). Read from kosmos origin/main baab2b36bf.

**Measured first, as the 02:46 plan's weakest premise asked.** The phone reaches the computer through the Kosmos+ gate with the computer's cookie and `Sec-Fetch-Site: same-origin` (ios/Kosmos/SettingsLogic.swift:61-72), so to server.js it is a remote request (`isRemoteRequest`) that passes `isViaScreen` (server.js:27060). Per route:

| section | routes | phone can use it? |
|---|---|---|
| Auto-save | GET/POST /api/settings `{autohandoff:{enabled,threshold}}` | yes, no remote guard |
| Prompter | GET/PUT /api/heartbeat-setting `{on, intervalMinutes}` | yes |
| Gemini subscription agents at once | GET/PUT /api/agycap-setting `{maxWorking}` | yes (isViaScreen passes on the phone's header) |
| Agents on one account at once | GET/PUT /api/workcap-setting `{maxWorking}` | yes, same |
| Agent Communication | GET/PUT /api/limits `{on, perHour}` | yes |
| Daily report | GET/PUT /api/feedback-setting `{on}` | yes |
| Community switch | GET/PUT /api/community-setting `{on}` (+ `stopped` sentence) | yes |
| Language | GET/PUT /api/agent-language `{choice}` | yes (refuses only an agent token) |
| Recommender | GET/PUT /api/recommender-setting `{on}` or `{guard, value}` | yes |
| Assigner | GET/PUT /api/assigner-setting `{on}` or `{failover}` | yes |
| Updates | POST /api/update, /update/check, PUT /api/autoupdate | **step-up**: in REMOTE_STEP_UP_EXACT (server.js:5774), so a phone session without a fresh full sign-in gets `remote_step_up`. D1c shows that sentence as is, never works around it. |

So the weakest premise held for Automation: nothing to file.

**The call for D1a:** a native "Automation" screen under Settings, one section per row above, each control reading the computer's own setting and writing it back, the same pattern as the phone-notification switches (read, write, on refusal the control goes back to what the computer says and the footer gives its sentence). Words are the board page's own (web/index.html s-sec-automation), not new ones. Choice lists (intervals, caps, tiers, languages) come from the computer's answer, never hard-coded, except Auto-save's 75-95% which the page itself hard-codes.

**Left for later slices, and why:** Prompter check-ins list, Community's industry / held posts / my posts / readiness lists (each its own routes and actions: D1d); AI policies and Global skills (D1b); Updates and Token usage (D1c); AI models and Connections (D2). The "Settings on your computer's board" row stays until the last of those lands, so nothing the page offers is lost in between.

**Rejected:** one screen holding every Automation box including Community's lists (that is four more routes with deletes and releases, too much for one reviewable PR); hard-coding the choice lists in Swift (they drift from the computer's).

**Weakest premise:** that the phone's `Sec-Fetch-Site` header is all `isViaScreen` needs through the gate. Read from source, not yet measured against a live gate; the UI test drives a stub. If the gate strips it, the four isViaScreen writes answer 403 "only you can change this, from Settings" and the screen shows that sentence, which is honest but useless, and I would file it.

**What would change my mind:** a relay-side reason the gate must strip Sec-Fetch-Site, or Josh wanting Automation kept on the computer only.

## Built
- ios/Kosmos/AutomationLogic.swift: per-box route, request, answer parse, refusal, notes, the page's words.
- ios/Kosmos/AutomationView.swift: one section per box; SettingsView gets an Automation row above the board row.
- ios/LogicTests/automation + run-automation.sh (in ios.yml); server.ios-routes-6838.test.js SITES entry.
- ios/KosmosUITests/AutomationUITests.swift (light and dark shots).

## Measured
- run-automation.sh: VERDICT PASS 180/180; a copy with accountCap pointed at agycap fails 1 of 165 (control).
- iOS sources type-check for arm64-apple-ios16.0-simulator; a planted type error is reported (control).
- node --test ios*/server.ios*/web.ios* + engine.reachable, fixture-discipline, verbs parity: 108/108; a bogus PUT /api/limitsx in SITES fails against a real board (control).

## Challenge loop ledger
