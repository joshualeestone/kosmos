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
- r2 sonnet: 0B/6W, five fixed, one kept. W1 the Ask line compared from the app's own string. W2 Remove's word checked as the script's `rm.textContent = 'Remove';`. W3 an add answer that is not JSON says "We could not add that skill." (the page's json().catch), a remove's says could-not-reach (its json() throws). W4 Add skill is always pressable, as the page's; blank fields go to the engine for its own sentence. W6 the last refusal clears when an add starts. W5 kept: clipping while an input method is composing at the limit can drop the composition; a page's maxlength has the same edge, so the phone matches it.
  (r2 follow-up: the sample build refuses a blank name with engine/skills.js's own sentence, checked against the engine; the UI test presses Add skill with nothing written and expects that sentence. Suite 63/63.)
- r3 opus: 0B/2W, both fixed. W1 Remove is a borderless button, so a tap on the name no longer arms it (the UI test taps the name and expects Remove unarmed). W2 the sample refuses as engine/skills.js does (no letters or numbers, blank words, a taken key, in its sentences, checked against the engine) with the engine's slugFor key, so the list never holds two rows with one key. Suite 67/67.
- r4 sonnet: 0B/4W, three fixed, one recorded. W1 Remove's label is a full 44-point target (borderless taps are the label's), the name keeps its room. W2 a field taking focus, or the app leaving the foreground, disarms Remove. W3 the UI test reveals Add skill again after typing and scrolls to the added row. W4 recorded: "Try again" (with "Reaching your computer…", "Looking…" aside, and the sign-in lines) is the app's own word, shared with Settings and Automation, not the page's; the page retries on the next visit, the phone offers the press.
- r5 opus: 0B/3W, all fixed. W1 arming Remove drops the keyboard (focused = false), so a later tap into either field is a focus change and disarms it (one shared Bool otherwise stayed true). W2 a removed skill's row goes on the computer's "done", before the list is read again, so its Remove cannot be pressed twice. W3 the Remove label wraps at the largest text sizes instead of running off the row (reasoned, not measured: the UI run is at the default size).
- r6 sonnet: 0B/2W, both fixed, three small gaps recorded. W1 focus is one value per field (enum), not a Bool shared by two. W2 a refused remove's sentence is said only if the skill is still listed after the read (a remove with no answer may have landed). Recorded, not changed: a 200 list answer with no `skills` and no ok:false reads as a failed read (the page would say "No skills here yet."), and a 200 DELETE with ok:false is a refusal (the page counts any 200); engine/skills.js sends neither shape. The words box's accessibility label "What the skill should do" is the app's own; its visible placeholder is the page's.
- r7 opus: 1B/1W, both fixed. B1 the Remove word is compared from the app's own string (`"rm.textContent = '" + W.remove + "';"`); r2 W2's line above said this already and was not true until now. Control: Words.remove changed to "Delete" fails that check. W1 recorded: the spinners' spoken labels "Removing" and "Adding" are the app's own words (VoiceOver only; nothing visible).
