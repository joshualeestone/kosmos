# oldsafari-8790: the board's pictures load on a browser with no Sec-Fetch-Site (kosmos#8790, step 1)

Finished means: on a browser that sends no Sec-Fetch-Site (Safari before 16.4), agent avatars, your picture, and image
and PDF-page previews on the board show, instead of staying refused by the computer's connector; nothing changes on a
browser that sends Sec-Fetch-Site; a picture that really fails still fails the way it did (kosmos#8636).

## Design (round 2: moved into the service worker after review round 1)
- web/sw.js: a GET from this origin's own page for a picture under /api/ (destination "image", or an image Accept
  where destination is missing) that the network answers 401 or 403 is asked for ONCE more with
  X-Kosmos-Board-Page: 1, and that answer is the picture. Anything else is the browser's own answer. A worker sees
  only its own pages' requests, so another site's image of this board never gets the header.
- web/index.html: on a first visit (no worker in charge yet) the board pictures that fail are noted, and when the
  worker takes charge each one still on the page is asked for again at the same address. No address is changed, no
  error is held back.
- Round 1's page-side retry was dropped: swapping an element to a blob: address broke the page's "only redraw when it
  changed" comparisons (header picture, swarm SVG avatars, the guide's avatar), raced on concurrent rows, and held up
  to 25 MB previews in memory.

## Not in this step
Downloads, folder zips, the diagnostics download and the service worker's fetches: they need a board-minted single-use
key (kosmos#8790 design note), a separate step. The relay side of the header is kosmos-relay PR 854.

## Weakest premise
That old Safari runs the worker's fetch handler for image loads and sends no Origin on the worker's own same-origin
GET (so the relay's no-Origin + header arm applies). Measured in Chromium only; old Safari is not available to run.
Also: other computers' boards' pictures are still refused on old Safari (cross-origin, the header would need a preflight).
