# policies-8959: #8959 slice D1b1, the computer's Global skills, native

Stacked on boardsettings-8959 (D1a) at af25f83e8e: both add a row to SettingsView's board section and a step to ios.yml and ui-sample.sh. After D1a merges: rebase --onto origin/main af25f83e8e, re-validate.

Card: plan issuecomment-7153365474 (the D1b split: D1b1 Global skills, D1b2 AI policies).

## Slice D1b split, and D1b1 plan (April, night shift, 23:0x CST). Read from origin/main 679b1060f8.

**Split:** D1b as planned (AI policies and Global skills) is two very different sizes. Global skills is a list, an add form and a Remove that asks once. AI policies carries who was told, re-fetching a linked policy, rename, remove, and the company's own policy shown read-only (web/index.html paintPolicy, about 250 lines). So: **D1b1 Global skills**, then **D1b2 AI policies**, one PR each.

**Measured:** GET and POST /api/skills, DELETE /api/skills/<key> (server.js:9451, 9455, 9864). None is in REMOTE_STEP_UP_EXACT or its patterns (DELETE is never gated there), and none asks isViaScreen or isRemoteRequest. POST /api/policy, /rename and /remove are the same (none gated); a policy "from a link" is fetched by the computer, not the phone, so D1b2 can offer it too.

**D1b1, the call:** a "Global skills" row under Automation opens a native screen, as the board's box (web/index.html s-sec-gskills):
- the page's line ("Skills every agent on this computer gets...") and its "Ask your agent" line;
- the list, names only (Josh 2026-08-23: header only), each with Remove, which asks once ("Remove it for good?") before it sends the DELETE, as the page;
- "Add a global skill": name and what it should do, then "Add skill"; on success the page's "Added. Every agent picks it up at its next restart." and the list read again;
- refusals in the computer's own `because`, read failures in the page's words.
Reuses Board.Skill and Board.parseSkills (the agent screen's skills read), so the two lists read the board's answer one way.

**Rejected:** an edit screen for a skill's words (the page has none; adding with the same name is the engine's to refuse); a swipe-to-delete with no second ask (the page asks once, and so does this).

**Weakest premise:** that DELETE through the Kosmos+ gate reaches the computer like GET and PUT do. The routes test sends each declared route to a real board, but not through the gate. If the gate refused DELETE, Remove would show the sign-in line, and I would file it.

**What would change my mind:** Josh wanting skills managed only at the computer.

## Built
- ios/Kosmos/GlobalSkillsLogic.swift (requests, answers, the page's words), GlobalSkillsView.swift; a Global skills row under Automation.
- ios/LogicTests/globalskills + run-globalskills.sh (in ios.yml); ios/KosmosUITests/GlobalSkillsUITests.swift (in ios/tools/ui-sample.sh).

## Measured
- run-globalskills.sh: PASS 54/54; a copy letting "/" through the key segment fails 2 of 54 (control).
- iOS sources type-check (simulator SDK).
- server.ios-routes-6838.test.js 5/5 with no SITES entry (each route is on its request's line); a planted DELETE /api/skillz fails it against a real board (control).
- node ios*/server.ios*/web.ios* + meta tests: 109/109.
- Weakest premise (DELETE through the gate): the shipped agent Remove already sends DELETE through the same gate (AgentInfoLogic removeRequest), so it is not new, but not measured live here.

## Challenge loop ledger
- r1 opus: 1B/8W, all fixed. B1 a fresh list clears the old line; a refused remove's sentence is said once, by the read after it. W2 a failed read empties the list, as the page (nothing stays pressable that it cannot vouch for). W3 typing, a read, another press or leaving disarms Remove (the page's blur). W4 the fields clip in onChange, in UTF-16 units as maxlength. W5 the words' size is left to the engine's own sentence (75 KB of CJK is sent); the field stops at the page's 65536. W6 an old computer's answer touches nothing, its spinner included. W7 the view's header says the UI test drives the sample path only. W8 page words looked for only in the section and its two script functions (with a control), and the step-up check reads the patterns too. W9 unused sampleMac removed. Suite 60/60.
