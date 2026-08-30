# Plan: #1587 gate the acct-add sign-in behind the install confirm

## Problem

Settings > Accounts was a second, ungated entry into /api/connect/start. The
acct-add click handler POSTed straight to the route, so starting a sign-in there
could begin a ~231MB Claude Code install with no warning, the same download the
first-run flow already gates behind #fr-claude-confirm. Two entry points, one
gate, and this one bypassed it.

Precondition #1556 (server-answerable willInstall) has landed, so the confirm
can be driven by a real field rather than frClaudeInstallNeeded's fail-open true.

## Fix (web/index.html only, plus its tests)

1. Extract the POST into `acctAddStart()`, so a gate can sit in front of it.
2. The acct-add click now learns willInstall from /api/first-run (the same
   source the first-run confirm reads) and, unless it is a definite
   `willInstall === false`, shows a confirm before the POST. A value it cannot
   read counts as "ask", never "no", so a silent download is impossible.
3. Add `#acct-add-confirm` to the accounts modal, mirroring `#fr-claude-confirm`
   (Confirm / Not now). Its Confirm calls acctAddStart; Not now re-enables the
   button.
4. Parameterize `frClaudeConfirmSentence(conn)` and `frClaudeDownloadBytes(conn)`
   with an optional state override (default FR.connect), so the accounts confirm
   reuses the exact same sentence source. No copy drift (the #1579 lesson).

## Tests

- New `#1587` test in web.accounts-add.test.js: the click cannot reach the POST
  without the willInstall gate (no /api/connect/start in the click handler; it
  fetches /api/first-run, checks willInstall, shows the confirm), and the confirm
  choices exist. Proven to RED on the pre-#1587 (ungated) page.
- Re-anchored the #248 ("never a plain start") and #1492 either-arm pins from
  the click handler to `acctAddStart`, where the POST now lives. The invariants
  are unchanged; only their anchor moved.

## Verification

- All 839 web.*.test.js pass.
- The #1587 test and the re-anchored #248 test RED against the ungated page,
  pass against the gated one (genuine controls, measured).
- No production code outside web/index.html; no em dashes.

## Collision

Measured before building (recorded on the card): connect-confirm (PR #1031) and
the three account branches (#1487/#1447/#1481) are all merged; Angel's active
switch-acct-1373 has zero hunks in the acct-add/confirm region (she confirmed).
Her #1373 only adds lines below 22806, so it shifts my confirm-fn line numbers
but does not conflict.
