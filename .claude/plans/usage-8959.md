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
