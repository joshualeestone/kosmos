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
