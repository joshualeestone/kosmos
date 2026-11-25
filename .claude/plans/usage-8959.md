# #8959 slice D1c2a: the computer's Token usage figures, native on the iPhone

Card: https://github.com/joshualeestone/kosmos/issues/8959 (plan comment 7155802174). Stacked on D1c1 (updates-8959 66c5bd0121). D1c2b, the four daily charts and the model donut, follows.

**Measured (board):**
- GET `/api/usage?days=all` answers `{byDay, byAgent, daysOnKosmos, rootsRead}`. It is not remote-gated.
- The page warns a read can take up to a minute, so the phone waits 120 s.
- Every figure is the page's own JS (usageTotals ... usageHistoryHtml, the formatters, USAGE_MODEL_PRICES).

**The call:** a "Token usage" row opens native figures in the page's words: the reading line, the hero (six figures), the model table, By agent with its note, Usage history, the counted-from sentence and the method note with the METR link. It also carries the page's empty and error sentences.

**Guards against drift:**
- JS toFixed is ported from the double's exact decimal value, with a tie going up. Swift's %.1f rounds ties to even, and multiplying first misjudges 9.95 (9.9499... in binary).
- Expected figures were computed by node from the page's own functions on one fixture: abbr, bigTokens, usd, tileSub1M, rowValue, the hero, the model table, the agent rows and note, the history rows and the counted-from sentence.
- The phone's price table is compared with the page's, entry by entry, and must have the same number of rows.

**Phone-specific:** the hint drops "(the daily charts show the last 14 days)" until D1c2b, and "Nothing here leaves the machine.", which is not so once the counts are shown on a phone.

**Rejected:** a phone-only figure, and keeping old figures on a failed refresh (the page clears them and says it could not read).

**Weakest premise:** toLocaleString and NumberFormatter both use the person's locale, so grouping matches on one person's devices. The suite pins en-US only.

## Built
- ios/Kosmos/UsageLogic.swift and UsageView.swift; a Token usage row in SettingsView.
- ios/LogicTests/usage + run-usage.sh (in ios.yml); ios/KosmosUITests/UsageUITests.swift (in ui-sample.sh).

## Measured (first build)
- run-usage.sh: PASS 57/57. Planted mutants: ties rounded down (8 of 57 fail), one price changed (1), history oldest first (2).
- The app and the UI test type-check. The ios*, server.ios* and web.ios* node tests (13 files): 72 pass, 0 fail.

## Challenge loop ledger

### Round 1 (opus, 01:38 CST): no BLOCKER, 2 MAJOR, 8 MINOR. Every figure checked by the reviewer matches the page, and every field name matches engine/usage.js.
- MAJOR 1 the UI test looked for a model's and an agent's name as their own texts, but each row is one combined element: rows now carry identifiers (usage-model-N, usage-agent-N, usage-history-row) and the test checks the row's label starts with the name.
- MAJOR 2 a 120 s limit gave up on reads the page waits for (its fetch has no limit; "the first time after an update it can take a few" minutes, and the board sends nothing until the count is done): 600 s, and the suite pins it.
- M4 a pull during a read started a second count on the computer: one read at a time, the page's USAGE_BUSY.
- M5 a NumberFormatter per call, twice per history row: one kept per locale.
- M6 the three small figures could be cut short at the largest text sizes: side by side while they fit (ViewThatFits), stacked otherwise.
- Kept: M1 and M2, equal totals ordering by name, where the page keeps the server's key order, which JSON parsing does not carry (rare; colours go by rank). M3 grouping follows the phone's region, the page the browser's language: on one person's devices they agree, and the region is the phone's own setting for numbers. M7 a null body or a boolean count, which the server never sends. M8 "per class" in the hint, true once D1c2b's per-class charts land.
- Measured: run-usage.sh PASS 57/57; app and UI-test typecheck 0 errors.

### Round 2 (sonnet, 01:42 CST): no BLOCKER, no MAJOR, 3 MINOR
- M1 after a computer switch an old read's defer could clear the new read's flag, letting a pull start a second count: the flag is cleared only by the read that is still the current one (generation).
- M2 the formatter cache was a bare static dictionary: now under a lock, so no later caller off the main actor can race it.
- M3 the small figures' fixed widths made the side-by-side row never fit: their labels wrap again, so the row stacks only when it truly does not fit.
- The reviewer checked the UI test's identifiers and the sample's figures against the view and the logic.
- Measured: run-usage.sh PASS 57/57; typecheck 0 errors.
