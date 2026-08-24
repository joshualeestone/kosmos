# updates-stale-691: the Updates card says "Up to date" beside "reload for 0.5.23"

## Finished looks like
With a newer version installed than the page that is open (server on 0.5.23, page
baked 0.5.22), pressing Check for Update writes "0.5.23 is installed. Reload this
page to use it." on the card line, never "Up to date." With the page current, the
same press still writes "Up to date." Nothing else on the card changes.

## Why
Josh, #chaoskosmos-design 2026-08-24 16:50, with a screenshot: the build line read
"version 0.5.22, reload for 0.5.23" and the verdict beside it read "Up to date."
Both were true in their own scope (nothing newer than 0.5.23 exists to fetch; the
open page is the older one) and together they read as broken. Mona Lisa refused it
as a copy fix (#691): the verdict arm in `paintUpdateCard` does not know the page
is stale, and no wording fixes not knowing.

## Changes
1. web/index.html `paintUpdateCard`: the reached-and-readable arm asks
   `pageIsStale(running)` (the one definition the build line and the toast already
   use) and, when asked and stale, writes the reload sentence instead of the verdict.
   Gated on UPD_ASKED like the verdict; at rest the build line carries "reload for".
2. server.test.js: every harness that extracts `paintUpdateCard` now supplies the
   page's own `bakedVersion` + `pageIsStale` (a helper), and a new test pins the
   stale press, the current press (control) and the unasked stale rest.
3. docs/browser-checks/render-updates-stale.js: on a real board, with the page's
   version meta set behind the served one, presses the real button and reads the
   real line; the control run (page current) still reads "Up to date." Wired into
   tools/browser-checks.sh and named in the README.

## Not in this change
The card's Update arm when an offer AND a stale page coincide (the toast prefers
stale, the card prefers the offer); the 409 arm already covers the press. The
button stays "Check for Update"; the reload control is the toast's.
