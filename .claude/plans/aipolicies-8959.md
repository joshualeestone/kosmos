# aipolicies-8959: #8959 slice D1b2, the computer's AI policies, native

Stacked on policies-8959 (D1b1) at 16b7bfd952, itself on D1a. After both merge: rebase --onto origin/main 16b7bfd952, re-validate.

Card plan: issuecomment-7154150434.

## Slice D1b2 plan (April, night shift, 23:5x CST): AI policies, native

Branch `aipolicies-8959`, stacked on D1b1 (16b7bfd952), which is stacked on D1a: all three add rows to the same Settings section.

**Routes, measured:** none is gated for a remote session (not in REMOTE_STEP_UP_EXACT or its patterns, no isViaScreen or isRemoteRequest). A policy "from a link" is fetched by the computer (`unfurl.pageText`), never by the phone.
- GET /api/policy (server.js:23227): `{state, policies:[{id,name,source,savedAt,chars,opening}], because, company}`
- POST /api/policy: `{name, text}` or `{name, url}` adds one; `{id, text|url}` replaces its words. Answers `{policies, saved, told}`.
- POST /api/policy/rename `{id, name}` and POST /api/policy/remove `{id}`. Both answer with `told`.

**The call:** an "AI policies" row under Global skills opens a native screen doing what the board's box does (web/index.html s-sec-policy and paintPolicy, polCard, polSaid, polSubmit, polConfirm), in its words:
- the box's line, then the lead ("Every agent gets it/all of these...") or "No policies here yet.";
- the company's policy first, read only, in the family's words on a family's Kosmos (plusOrgIn);
- each policy's name, its source line ("Pasted" or "From <link>", ", updated <date>"), and its first 240 characters;
- Rename (a field with Keep and Leave it), Replace its words (the add form switches to "Replace the words of <name>"), and Remove, which asks once ("Remove it for good?");
- Add a policy: a name, then a link ("Fetch it") or pasted words ("Hand it to every agent"). The confirm is the page's own: "Hand this policy to every agent?", with its line and "Not yet" / "Hand it out", titled with the policy's name;
- after every change, polSaid's sentence: who was told, and who was not yet and why, by name.

**Rejected:** dropping "from a link" on the phone. The computer does the fetch, so the phone loses nothing by offering it.

**Weakest premise:** that "From <link>"'s date reads the same on the phone. The page uses the browser's `toLocaleDateString`; the phone uses the iPhone's short date style. Same day, possibly a different format. Kept, noted.

**What would change my mind:** Josh wanting company AI rules changed only at the computer.

## Built
- ios/Kosmos/AIPoliciesLogic.swift (requests, list, company card, polFrom, polSaid, the form's checks, the confirm title), AIPoliciesView.swift; an AI policies row under Global skills.
- ios/LogicTests/aipolicies + run-aipolicies.sh (in ios.yml); ios/KosmosUITests/AIPoliciesUITests.swift (in ios/tools/ui-sample.sh).

## Measured (first build)
- run-aipolicies.sh: PASS 105/105. Control: counting any state but could_not as told fails 1 of 105.
- server.ios-routes-6838.test.js 5/5 (each route on its request's line); a planted POST /api/policy/renamex fails against a real board.
- node ios*/server.ios*/web.ios* + meta tests: 110 tests, all passing once the routes were on their lines.
- iOS sources type-check.

## Challenge loop ledger

### Round 1 (opus, 2026-11-25 00:04 CST): no BLOCKER, no MAJOR, 5 MINOR
- M1 a refused first save dropped the first load in flight, leaving "Reaching your computer" up: fixed, a refusal reloads when `read == nil`.
- M2 a 500 with `{error}` on GET: the page shows "No policies here yet.", the phone says it could not reach Kosmos. Kept on purpose (the phone's sentence is the true one); recorded here as a deliberate difference.
- M3 Keep / Leave it were checked by substring: now anchored to `keep.textContent = 'Keep';` and `leave.textContent = 'Leave it';`. Control: rewording the page's Keep to "Keep it" fails 1 of 104.
- M4 a refused Remove dropped back to "Remove": now re-armed, as the page.
- M5 sample build: an add after removing every policy did nothing: `.none` now starts an empty list. Also fixed (found while there): sample ids `s<count+1>` collided after a removal; now unique.
- Measured: run-aipolicies.sh PASS 104/104 (two loose checks became one anchored one); typecheck rc 0, 0 errors.

### Round 2 (sonnet, 00:11 CST): no BLOCKER, 1 MAJOR, 4 MINOR
- MAJOR a change's sentence showed only in the list's footer, above the form, so an add's "Saved." or "Give it a name first." could land off screen. Fixed: the note shows beside what was tapped (under the form for add and replace, as the page's pol-msg sits by its form; under the list for rename and remove), and VoiceOver announces it.
- M2 an unknown outcome (no answer, status 0, e.g. a slow link fetch past 30 s) left the list stale: a refusal with status 0 now fetches the list again.
- M3 the form was cleared after the list reload, so a replace started during the reload was wiped: change() now takes the clear as `then`, run before the reload.
- M4 an empty rename closes the alert and loses the text: kept; an iOS alert closes on any button. The page's "Give it a name first." shows under the list.
- M5 a failed reload after a success replaces the list with the error: kept, as the page does; keeping a stale list would hide that the computer did not answer.
- Measured: typecheck rc 0; run-aipolicies.sh PASS 104/104 (view-only changes; the UI run will see the placement).

### Round 3 (opus, 00:19 CST): no BLOCKER, no MAJOR, 5 MINOR
- M1 busy was cleared before the reload, so a second change could drop that reload: busy now holds until the reload ends (defer).
- M2 a refusal whose answer was not JSON (a relay's 502) is as uncertain as status 0: a refusal now always fetches the list again. Noted beside it: a link fetch still running past the 30 s limit can land after that fetch; pull to refresh shows it.
- M3 the same sentence twice was announced once: each note is now its own value (an id), and VoiceOver announces on every one.
- M4 the UI test did not check where the note shows: it now asserts the note is shown once, says the sentence, sits under Save after an add and above the add form after a remove.
- M5 a rename to the same name moved an existing note: the note's place is set only where a note is set.
- Measured: app typecheck rc 0; the UI test type-checks against XCTest (control: a planted error reports 2 errors); run-aipolicies.sh PASS 104/104.

### Round 4 (sonnet, 00:25 CST): no BLOCKER, no MAJOR, 3 MINOR
- M1 the change's `defer { busy = false }` could clear busy for a change on another computer after a switch: it now clears only while the same computer is shown.
- M2 a refusal whose reload also fails now replaces the list with the error (wider since round 3's always-reload): kept, as round 2's M5 (the page does the same, and a stale list would hide that the computer did not answer); the refusal's note stays, it sits in the footer.
- M3 the UI test's placement checks were skipped when the reference was not drawn (a lazy List): replaced by identifiers. Each footer's note has its own (`policy-note-list`, `policy-note-form`), and the test asserts the right one says the sentence and the other is absent. No frames, nothing to skip.
- Measured: app and UI-test typecheck rc 0, 0 errors; run-aipolicies.sh PASS 104/104.
