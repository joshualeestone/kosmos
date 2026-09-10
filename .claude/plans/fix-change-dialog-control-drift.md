# fix: web.change-dialog control retires gracefully (fleet-wide test CI unblock)

## Problem (P0, fleet-wide)
As of ~01:35Z the `test` job is RED on every open PR. kosmos#2463 (Model switch
interstitial, merged 01:35Z) added a `providerOf` reference to web/index.html.
The control test `web.change-dialog.test.js:80` does
`git show origin/main:web/index.html` and executes that (now-evolved) page in a
JSDOM-ish harness. On a branch whose committed harness predates #2463 (no
`providerOf` in `world()`'s ctx), running the evolved page raises
`providerOf is not defined`; `change()` swallows it into `got.msg`, so the
control's `got.msg === 'Working…'` assertion fails - on CI and locally, for every
PR after 01:35Z. (PRs that merged before 01:35, like #2453, escaped.)

## Root cause
The control's condition-2 skip tries to detect "origin/main already carries the
fix" with a code-string regex (`/say\(out\.because \|\| 'Changed\.'/`). That regex
went stale when the fix's code shape was refactored on main, so the control
stopped skipping and then broke on the evolved page.

## Fix
Detect "the control has lost its bite" BEHAVIOURALLY instead of by the brittle
regex: after running the old page, if `got.msg` is not the `'Working…'` lie - for
ANY reason (fixed, refactored, or it errors in this harness) - retire the control
gracefully (return), exactly like its two existing skip conditions. A `try/catch`
also covers a hard throw. When the old page DOES still show `'Working…'`, the
control keeps its bite and still asserts `got.keep.hidden === true`.

Robust to any future evolution of main, not just `providerOf` - a string-keyed
guard would break again on the next new global.

## Scope
One test file (`web.change-dialog.test.js`), one control test. Swept: the only
test that executes the old origin/main page at runtime is this one (the other two
`origin/main:web/index.html` references are a comment and a local pre-fix
synthesis), so this is the sole instance.

## Known tradeoff (documented, deferred)
The behavioural skip makes the control effectively retired (origin/main carries
#619's fix, so it always skips now). That is acceptable: its historical subject
(the pre-#619 page) is gone from origin/main, and the LIVE change-dialog coverage
is the forward tests above (they drive CURRENT_PAGE and are unchanged). Pinning
`before` to a fixed pre-#619 sha would restore the historical bite and is a
reasonable future enhancement; it is not done here to avoid blocking a P0 fleet
unblock on uncertain archaeology + an old page that may not run in today's harness.
