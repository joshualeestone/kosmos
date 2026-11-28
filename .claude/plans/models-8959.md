# #8959 slice D2: AI Models and Connections, native on the iPhone (PLANNING, not built)

Card: https://github.com/joshualeestone/kosmos/issues/8959 (master plan 7120473038, slice D, "Native, read with a plain line"). Branch `models-8959` from origin/main 6999392572.

## Measured so far (11-28 08:5x CST, read from the code, not from a running board)
- The board's Settings has 9 sections now (web/index.html ~19320): Your Profile, AI Models (`s-sec-accounts`), Connections (`s-sec-connect`), Global Skills, AI Policies, Computer, Automation, Token Usage, Updates. D1 made Automation, AI Policies, Global Skills, Token Usage and Updates native; Profile was already. D2 is AI Models and Connections; Computer stays off the phone (master plan).
- **AI Models** calls about 20 `/api/accounts*` routes (list, per-provider sign-in and keys, subscriptions, Qwen local, share, compat). The phone already reads `GET /api/accounts` and `/api/accounts/compat` (NewAgentPicker), so the read is reachable with the phone's token. Per the master plan, signing in runs on the computer: each provider row says whether it is signed in, then "Sign in to this on your computer", no link.
- **Connections:** the page reads `GET /api/connections` (server.js ~19180), which makes a live `verify()` on EVERY door, and the search services (Brave, Exa, Tavily, Serper) meter that against the person's own paid quota (#1636). `GET /api/connections/held` (~19130) reads the disk only, never a verify, costs nothing, and is behind the same cross-site guard (the phone sends same-origin, so it passes).

- **`GET /api/accounts` is live-checked per account** (server.js ~15259, `listLive()`), and its stated invariant is: every caller is a person pressing something, never a timer. So D2a reads it on open and on a pull only, with NO repeating read (unlike D1d1's 30 s check-ins). Rejected: a timer like the check-ins (it would pay a live check per account every 30 s).
- **The phone already parses it:** `NewAgentPicker.parseAccounts` reads each row's dir, provider (acctProvider's rules), email, chosen name, key tail, label, local, isDefault, memoryShared, and `connection.badge` / `connection.state`, which is the page's one badge vocabulary across providers. D2a reuses that parser rather than writing a second one.

## Decisions so far
- The phone lists Connections from `/api/connections/held`, never from the sweep, and never on a timer. Rejected: the sweep on open (each open of a phone screen would spend the person's search quota).
- D2 splits: **D2a AI Models (read only)**, then **D2b Connections (read only, held state; pasted-key add native per the master plan, browser sign-in says "Connect this on your computer")**. Then **D2c**: with nothing left, remove `openBoardSettings`, the Settings board row and the Kosmos+ `openPage` (master plan: "When D lands"); AutomationUITests' board-row assertion flips to asserting it is gone.

## Weakest premise
That `/held` carries enough to draw each row honestly. It is the disk's record (what was saved), not a verified check, so a key that has since been revoked would read as connected. The row must say so in words (for example "saved on your computer"), or D2b reads the sweep once, on an explicit tap only.

- **The page's badge words** (paintAccounts, web/index.html ~32310-32366) are about 12 ordered cases, not a 4-word map: a login that has run out but whose agents still work until a time ("stopsAt", outranks everything); "Login expired" (loginEnded, no stop time ahead); a login inside the notice's window ("expires today" / "in N days", loginExpiresInDays, with loginExpiresAt's date); "Signed in · login good until <date>" (working from login, or signed_in_unverified with a login date); "Signed in" for a login-green row with no date; "Signed in · checked/active <age>" (working); "Not connected · rejected <age>"; "Not confirmed since <date>" (signed_in_unverified with notConfirmedSince, the year only when not this year); plain "Signed in" (unverified); signed_out and unchecked use their own sentences (noneWhy, unknownWhy); then OpenAI's ChatGPT-subscription row has its own branch.
- So `parseAccounts` needs more fields than the picker reads: connection.observedFrom, loginStopsAt, loginEnded, loginExpiresInDays, loginExpiresAt, notConfirmedSince, the login date and the age the page builds (to measure: loginDate's and ageStr's sources, a few lines above 32310), and authMode.

## D2a design (draft)
- **Logic:** `ModelsLogic.swift`, a pure `badge(for: Account, now:) -> (words, tone, why)` following the page's order exactly, plus the sentences noneWhy, unknownWhy, rejectedWhy and the others it uses. Extend NewAgentPicker.Account (or wrap it) with the extra fields, so the picker's parser stays the one parser.
- **Parity:** `web.models-ios-parity-8959.test.js` lifts the page's own badge function (or its strings and order) and checks the phone's on the same rows, with the clock and locale pinned, as `web.usage-ios-parity-8959` does. This is the guard that the two never drift.
- **Screen:** Settings > AI Models, native: one row per account grouped by provider, the name (acctChosenName / email / key tail), the badge and its why as the row's detail, and one footer line "Sign in, add or change an account on your computer." No buttons. Read on open and on pull only.
- **Tests:** ios/LogicTests/models + run-models.sh (`-Onone`), a fixture with a row for every badge case, the UI test with a screenshot; tmpscope first in the new node test; run every iOS node test file before validating.

- **Inputs measured (web/index.html ~32254-32309):** ageStr = agoWords(connection.observedAgeMs) (function at ~27334); fromCheck = observedFrom === 'check' (the pill says "checked" instead of "active"); loginDate from connection.loginValidUntil, in the viewer's calendar, the year only when not this year; noneWhy / unknownWhy are connection.because or a fixed sentence.
- **Decided: the phone shows the pill's words exactly, not the tooltips.** The tooltips (workingWhy, unverifiedWhy, loginOkWhy...) point at "Check now", a button the phone will not have. signed_out and unchecked are the exception, because their pill IS their sentence (connection.because). One footer: "To check, sign in, add or change an account, use Settings on your computer." Rejected: copying the tooltips with "Check now" swapped out (two wordings of one fact, and the parity test could not hold them).

## Still to measure before building D2a
- Whether any AI Models row the page shows reads a route the phone token is refused.

## Challenge loop ledger

### Round 1 (opus, 12:5x CST 11-28): no BLOCKER, 2 MAJOR, 6 MINOR. The reviewer read the chain line by line: case order, conditions and words all match.
- MAJOR 1 the loginok pill (signed_in_unverified with a login date) drew the working green; the page draws it grey (ruling C, #874). Now Palette.secondary.
- MAJOR 2 GLM and MiniMax accounts were sectioned and named as Claude (the picker's Provider lacks them). This screen sections them by their own row ("Z.ai GLM", "MiniMax", the page's words) and names a keyed one by its tail; the picker's gap is noted on the card, not widened (its menu is allCases).
- M3 a 0 login or expiry time gave a 1970 date; the page treats 0 as no date. Fixed, and two fixture rows pin it against the page.
- M4 the parity test could not see a page branch no row reached: it now counts the chain's connBadge assignments (14) and fails on any unreached (control: dropping the rejected row fails branch 7).
- M5 the fixture's zone and locale were hard-coded on both sides: both read them from fixture.json.
- M6 kept: a check still running stays "Signed in" until a pull. The page re-reads it on its own; this route's rule forbids a timer, and pull is the phone's re-read.
- M7 the could-not-read line was red; the page's is a neutral hint. Now secondary.
- M8 the UI test's header and footer checks waited for nothing, and grouped headers are uppercased: they wait, and the header keeps its case (textCase(nil)).
- Measured: run-models.sh 94/94; parity 3/3; 20 iOS node files; app and UI typecheck.

### Round 2 (sonnet, 13:2x CST 11-28): no BLOCKER, 3 MAJOR, 7 MINOR.
- MAJOR 1 the page draws two rows before its chain: Gemini through Antigravity (named by email, else "Google subscription"; always the grey "Signed in") and Meta Muse ("Meta account"; Signed in · confirmed <ago>, Not confirmed since, Not connected, or Signed in). Ported in Models.pill and Models.name, and the parity test now lifts both branches and checks each row's NAME too (the fixture has 34 rows).
- MAJOR 2 sections were in first-appearance order; the page stable-sorts by PROVIDER_ORDER of each group's first row (acctProvider). Ported (an unknown provider is acctProvider's anthropic, so it sorts with Claude, as the page does).
- MAJOR 3 the heading came from the phone's Provider enum; the page groups and labels by the row's providerName ("OpenAI" or "Anthropic / Claude" without one). Ported; the parity test checks the order of fixture.json groupRows against accountGroupsHtml itself.
- M fixed: the previous computer's rows for the frame before .task resets (the list shows only for shownURL == mac.url); the UI test finds rows by identifier whatever element type, and the vacuous "no Check now" assertion is gone.
- M kept: the page's qualifier tags beside look-alike names, the organization line and a key tail under a chosen name (a second line per row; a follow-up if two accounts read alike in use); a failed pull replaces the list, as the page's non-follow-up read does; the dot colours are the app's palette, not the page's CSS values (the parity test pins the class); the picker's primaryName still lacks glm and minimax (noted on the card, outside this slice).
- Measured: run-models.sh 102/102; parity 4/4; room 965/965; 20 iOS node files 113/113; app and UI typecheck (only the known RoomView.swift:762 at a 1 s limit).

### Round 3 (opus, 13:4x CST 11-28): no BLOCKER, no MAJOR, 8 MINOR. The reviewer found every fixture row matching the page (order, words, colours, names, sections) and the picker unaffected.
- M1 names were checked against the page mostly on the dir fallback: 9 rows added (email, a chosen name trimmed, OpenAI and Grok key tails, a label, a Qwen host and Qwen on this computer), now 43 rows.
- M2 isOpenai was written into the test: it is lifted from the page's own line now.
- M3 loginAdvWhen's "on <weekday>" arm was never reached: a stop three days out pins it ("on Monday, Nov 30 at about 12:00 PM").
- M4 the no-providerName fallback lowercased the provider; the page compares `provider === 'openai'` exactly: the row's provider as sent is kept and compared (a groupRows row "OpenAI" pins it).
- M5 loginEnded: 1 read as true; the page needs === true: a JSON boolean only (a fixture row pins it).
- M6 a huge finite age could trap Int(): capped.
- M8 the UI test counted rows exactly and read labels by position: at least three, each found by its whole label.
- M7 kept: VoiceOver reads the pill's words, which are the page's; three "Signed in" differ only by dot colour, as on the page's visible text. Adding spoken tone words is new copy, a separate decision.
- Loop ends here: round 3 found nothing at BLOCKER or MAJOR, and its MINORs are fixed or kept with reasons.
- Measured: run-models.sh 111/111; parity 4/4; room 965/965; 20 iOS node files 113/113; app and UI typecheck 0.
