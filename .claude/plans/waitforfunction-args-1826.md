# #1826 -- waitForFunction options in the wrong argument position

## The bug

Playwright's signature is `waitForFunction(pageFunction[, arg[, options]])`. The 2nd
positional is `arg` (handed to the pageFunction), the 3rd is `options` ({timeout, polling}).
Fifteen browser-check calls passed the options object as the 2nd positional arg:
`waitForFunction(fn, { timeout: N })`. Playwright reads `{timeout: N}` as `arg`, leaves
options undefined, so the intended 4000-10000ms timeout defaults to 30000ms and never
applies. Every affected pageFunction is param-less, so the misplaced object is silently
ignored by the function too -- the only observable effect is the wrong timeout.

## Scope: FIFTEEN, not the card's nine

The card said nine (written from a line-oriented grep). A balanced-paren parse of all 66
waitForFunction calls in docs/browser-checks/ found the full set of 15 (a grep misses
multi-line calls and misclassifies). Fixing only nine would leave six with the same defect.

- render-model-change.js: 10  (lines 138,187,199,205,218,231,309,313,324,331)
- render-pjsettings.js:     2  (82, 92)
- render-first-run.js:      2  (464, 471)
- render-boot-no-flash.js:  1  (68)

## The fix

Insert `null` as the arg: `waitForFunction(fn, { timeout })` -> `waitForFunction(fn, null,
{ timeout })`. Safe for all 15 because every pageFunction is param-less (verified). Makes
the intended timeout take effect.

## Verification

- Mechanical: balanced-paren parse re-run -> 0 buggy remaining; `node -c` on all 4 files -> OK.
- Live (this bot session, pw-runtime, no MCP): render-model-change.js and render-pjsettings.js
  both EXIT=0, 0 failures, under the corrected timeouts = 12/15.
- render-first-run.js (2) and render-boot-no-flash.js (1) carry the identical fix and need a
  booted board; they are exercised by the full browser-checks.sh gate. Their live run waits
  for a browser window (the serving cut owns the browser until SERVED; do not contend with
  Pete's gate-red-bisect gates).

## Gates

- Touches only docs/browser-checks/*.js, NOT web/, so no #1720 trailer required.
- CI (#1794) runs on push; advisory.
