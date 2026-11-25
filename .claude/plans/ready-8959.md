# #8959 slice D1d3a: Community's "Where each agent stands", native on the iPhone

Card: https://github.com/joshualeestone/kosmos/issues/8959 (plan 7158390965). Stacked on D1d2b (held-8959 a8c7b738ff).

**The call:** under the held posts, the page's #community-ready list (refreshCommunityReady, communityReadyPaint, communityReadyLine, communityReadyWhen):
- the heading, its note, and one row per agent: the name, then the board's summary with its needs-you words marked (a dot, "Needs you: " for VoiceOver). Each row opens (DisclosureGroup) to its lines, each with its time in the person's zone (the year only when it is not this one) or "a date Kosmos could not read".
- "Looking at your agents.", "Kosmos lists no agents yet.", or could not check.
- Read with the rest, and again after a release or discard, as communityHeldDone does. Opened rows are kept per agent across reads; agents no longer listed are forgotten.

**Weakest premise:** the date's shape. The page uses toLocaleString with month short, day, hour and minute; the phone uses DateFormatter's localized template ("MMMdjmm"). Same pieces, possibly different punctuation per locale.

## Built
- ios/Kosmos/ReadyLogic.swift; AutomationView (readyRows, needsYouDot, readReady).
- ios/LogicTests/ready + run-ready.sh (in ios.yml); AutomationUITests checks the sample's two rows.

## Measured (first build)
- run-ready.sh PASS 23/23. Mutants: needs-you words split off a summary they do not start (1 of 23 fails), a time on every line (2).
- run-automation.sh PASS 229/229; app and UI-test typecheck 0 errors.

## Challenge loop ledger

### Round 1 (opus, 03:34 CST): no BLOCKER, 1 MAJOR, 5 MINOR. The reviewer confirmed the rows drawn, the needs-you split, the could-not lines, the 503, and `at` (milliseconds, dropped when undefined) all match the page and the engine.
- MAJOR the rows name the Community and "Check on your agents" switches, and the page reads them again after either is saved (index.html 29680, 39341); the phone did not. Now a saved Community or Prompter switch reads them again.
- M2 the UI test looked up Dana after scrolling to Eli: each is revealed on its own, top to bottom.
- M3 needsYou took a JSON 1 as true: only a real true counts, as the page's === true.
- M4 the milliseconds conversion and the engine's real no-`at` line were untested: now pinned (at == 1795500000 s; no at with an after gives the unreadable-date words; a boolean at is no time).
- M5 the sample's words were not the engine's: its summaries join with " · " (SUMMARY_JOIN, checked against the engine) and its lines are the engine's kind.
- M6 VoiceOver read the mark as "Needs you: ," with a trailing colon: one label, "Needs you". The dot's baseline offset is cosmetic and kept.
- Measured: run-ready.sh PASS 28/28; typecheck 0 errors (app and UI test).

### Round 2 (sonnet, 03:36 CST): nothing material, 3 MINOR. Loop ends here.
- The reviewer verified the write() re-read: never for a refused save, after the save's own UI is settled, and with its own generation.
- M1 kept: a failed re-read shows "could not check", as the page's ("A failed read always paints").
- M2 a refused Community or Prompter save now also reads the rows again (a save with no answer may have landed).
- M3 to watch on the first UI run: the identifier on a DisclosureGroup whose label is combined.
