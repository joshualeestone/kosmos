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

**Weakest premise:** that the phone's `Sec-Fetch-Site` header is all `isViaScreen` needs through the gate. Read from source, not yet measured against a live gate; the UI test drives a stub. If the gate stripped it, the tunnel would hand the request no board token and the computer would refuse every request here (reads too) with its general 403 before any route's own check, so the whole screen would show the phone's sign-in line (Board.phoneShutOut), and I would file it. (Corrected in review 5: an earlier version said only the four isViaScreen writes would fail.)

**What would change my mind:** a relay-side reason the gate must strip Sec-Fetch-Site, or Josh wanting Automation kept on the computer only.

## Built
- ios/Kosmos/AutomationLogic.swift: per-box route, request, answer parse, refusal, notes, the page's words.
- ios/Kosmos/AutomationView.swift: one section per box; SettingsView gets an Automation row above the board row.
- ios/LogicTests/automation + run-automation.sh (in ios.yml); server.ios-routes-6838.test.js SITES entry.
- ios/KosmosUITests/AutomationUITests.swift: three shots per run. CI runs it in ios/tools/ui-sample.sh (lazy arm). The light and dark shots for review come from my local runner (~/.cache/claude-handoffs/detached/ui-class.sh, not in the repo), which runs the class once per appearance (simctl ui appearance).

## Measured
- run-automation.sh (after review 1): VERDICT PASS 214/214. Controls on that suite: accountCap pointed at agycap fails 1 of 214; Daily report damaged-rule loosened to `ok == false` fails 1 of 214.
- iOS sources type-check for arm64-apple-ios16.0-simulator; a planted type error is reported (control).
- node --test ios*/server.ios*/web.ios* + engine.reachable, fixture-discipline, verbs parity: 108/108; a bogus PUT /api/limitsx in SITES fails against a real board (control).

## Challenge loop ledger
- r1 opus: 3B/9W, all fixed. B1 guards heading ("Never let a recommendation:") added; B2 hints cut where they point "below" to lists the phone lacks (pieces checked against the page), closing line names what is still on the board; B3 plan lines corrected and controls rerun on the current suite. W1/W2 a write that does not come back clean re-reads, and a 200 the box cannot read is "Saved, but we could not read it back just now."; W3 no read while a save is out, and the save's end bumps the generation; W4 Language keeps its list when the choice is unread (page's "Could not be read just now" plus its sentence); W5 Community's own unread sentence; W6 Daily report read exactly as the page (damaged file is Off with its sentence, any other shape unread); W7 the messages limit's default-in-use sentence; W8 Language save says what happens to running agents, in the page's six sentences; W9 closing line reworded, and the unread sentences are now shown.
- r2 sonnet: 1B/3W. B1 the UI test was run by nothing in CI: added to ios/tools/ui-sample.sh (lazy arm, its own line); plan says where the light/dark shots come from. W2 a 200 that is not JSON is refused, not saved (test added). W3 coming back to the screen keeps each box's last line (only a pull clears them). W4 kept deliberately: Daily report's unread line on the page ("Open Kosmos from its icon") is advice for the computer; on the phone the general could-not-read line with Try again is the true one, so this box uses it, not the page's.
- r3 opus: 0B/5W, all fixed. W1 sample lists are the engine's own (heartbeat, agycap, workcap, limits), checked against the engine files; control (old account-cap list) fails 1 of 223. W2 picking the ticked row sends nothing. W3 every read takes its own generation, so an older read cannot land over a newer. W4 Language's "Could not be read just now" row is disabled, as on the page. W5 a Language save read back unread shows only "Saved, but we could not read it back just now."; failover's "Off by default." always shows under its hint, as on the page. Suite 223/223.
- r4 sonnet: 0B/5W, all fixed. W1 a failed read always says the page's read line, never the server's GET body. W2 a 403 is the phone's sign-in (kosmos#7840's rule) unless it is the computer's own "only you can change this, from Settings" (checked against server.js). W3 the UI test reads a switch's words from the switch's own label, not a separate text. W4 the screen's first read is keyed on the computer (task(id:)), so one that arrives after opening is read. W5 a cancelled newest read leaves Try again, not an endless wait. Suite 226/226.
- r5 opus: 0B/6W, all fixed. W1 another computer starts the screen over (loads, notes, pending cleared, generations bumped), and a save's answer from the previous computer is dropped. W2 every 403 is the sign-in line, the computer's "from Settings" sentence included; the weakest-premise paragraph corrected. W3 the Community hint keeps "and the kind of business you pick, if you pick one" (a consent switch), only "below" goes. W4 a read-back that works clears "could not read it back" (Language keeps it, as the page). W5 a refusal and a failed re-read with the same sentence show it once. W6 Community's unread sentence for every failed read but 401, 403 and no answer. Suite 229/229.
