# fix: re-anchor connect-confirm green test (red main, blocks launch merge train)

## Problem
web.connect-confirm.test.js "a connected provider row goes green" fails on origin/main
itself (confirmed 7/8 on a clean origin/main checkout), blocking every rebased PR incl
the 0.6.39 launch fixes. Cause: a fragile POSITIONAL test. It did
CODE.indexOf("const connectBtn = document.getElementById('fr-llm-connect')") then
slice(at, at+600) and asserted the is-connected toggle was inside. A recent main change
added a NEW same-id lookup earlier (frClaudeConfirm), so indexOf grabbed the wrong block;
the real toggle (in frPaintSubscription) sits 8854 chars away, outside 600.

## Approach (Splinter's ruling: re-anchor, do NOT widen)
Bind the block to the OWNING function: CODE.indexOf('function frPaintSubscription') to the
next top-level function. An insert inside it still matches; an insert outside cannot break
it. The assertion is unchanged (exact classList.toggle('is-connected', done)), so it still
discriminates (green tied to the same `done` as the label). Test-only change.

## Verified
8/8 pass with the fix; 7/8 (this test) on clean origin/main before it. diff em-dash clean.
