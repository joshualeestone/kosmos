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
