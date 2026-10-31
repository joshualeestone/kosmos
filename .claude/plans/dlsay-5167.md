# #5167: a download the Mac app refuses is said on screen, not only logged

**Branch:** `dlsay-5167` · **Card:** kosmos#5167 · **Why now:** a first outside report (2026-10-27): the Mac app on a laptop "can't download things there" from a Kosmos+ computer, while the browser can. Splinter: make every quiet refusal visible whatever the repro shows.

## The defect

The Mac download handling shipped in 0.7.38 (PR #5263). Several refusals were logged only: a page that is not a board, a file not from the page's origin, a computer the person answered Don't Allow to, WebKit stopping a download, a redirect to another origin. Return answers Don't Allow on the per-computer question on purpose, so a person who dismissed it with Return had every later download from that computer refused with nothing on screen. That fits the report exactly.

## The change

1. `tellDownloadFailed(..., refusal: true)` shows one modal alert, "Kosmos did not save that file: <why>", at all six refusal sites.
2. A pure guard, `refusalShouldShow`, so a page cannot pile alerts up or trap the person: not while any download alert is up (`alertsOnScreen`, a count for every alert, failures too), not while an Allow question is pending, not within 10 s of the last refusal's OK whatever its sentence, and at most two of one sentence per page.
3. The Allow question waits while a download alert is up, so a Return meant for one never answers the other.
4. A refused computer says "Downloads from X are off until you choose View > Reload, which asks again."

## Tests

- Mode selftest: 9 new `refusalShouldShow` rows (two shown, six logged, a control); 214 rows.
- Live download selftest: every refusal path's sentence (read before the guard), one refusal reaches the screen, and the real Allow question waits while an alert stands up; 32 rows.
- Source tests (`native-app.*.test.js`): 154 pass, pinning each refusal site, the guard's inputs and the count's raise and lower.

## Not covered

A real connect-mode run against a Kosmos+ computer: it needs an admitted device session on a person's device (the card's needs-device).
