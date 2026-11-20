# oldsafari-8790: the board's pictures load on a browser with no Sec-Fetch-Site (kosmos#8790, step 1)

Finished means: on a browser that sends no Sec-Fetch-Site (Safari before 16.4), agent avatars, your picture, and image
and PDF-page previews on the board show, instead of staying refused by the computer's connector; nothing changes on a
browser that sends Sec-Fetch-Site; a picture that really fails still fails the way it did (kosmos#8636).

## Design (round 2: moved into the service worker after review round 1)
- web/sw.js: a GET from this origin's own page for a picture under /api/ (destination "image", or an image Accept
  where destination is missing) that the network answers 401 or 403 is asked for ONCE more with
  X-Kosmos-Board-Page: 1, and that answer is the picture. Anything else is the browser's own answer. A worker sees
  only its own pages' requests, so another site's image of this board never gets the header.
- web/index.html: for the first two minutes of every page, the board pictures that fail (<img src>, SVG <image href>)
  are noted; when a worker takes charge (first visit, hard reload, a worker update) each one still on the page and not
  shown is asked for again at the same address, and a board picture still LOADING at the takeover (asked
  before the worker) that fails afterwards is asked for again too (each element at most once); any other later failure
  went through the worker and is left as it was, and only those addresses leave kosmos#8636's failed-preview list. A
  ready worker is asked to take charge ('claim', handled in sw.js) only once a board picture has failed on a page no
  worker controls. No address is changed, no error is held back. The worker cancels the body of a refusal it discards.
- Round 1's page-side retry was dropped: swapping an element to a blob: address broke the page's "only redraw when it
  changed" comparisons (header picture, swarm SVG avatars, the guide's avatar), raced on concurrent rows, and held up
  to 25 MB previews in memory.

## What changes on a browser that sends Sec-Fetch-Site (measured, rounds 4 to 6)
Nothing a person sees in the ordinary case. The costs, all bounded:
- Every board picture under /api/ reaches the board through the worker, so it says Sec-Fetch-Dest "empty" rather
  than "image" (nothing on the relay or board reads it); a real 401 or 403 costs one more request.
- On a hard-reloaded page, a failed board picture (a 404 too) asks the worker to take charge.
- In the two minutes after a takeover (a first visit, a hard reload, a worker update): a board picture that was
  loading at the takeover and then really fails is asked for once more, and its address leaves kosmos#8636's
  failed-preview list, so a later redraw of that card asks for it once more too. A picture noted as failed before a
  worker update is asked for once more at the update. A lazy picture off screen at the takeover is not counted.
- After the two minutes nothing here listens.

## Not in this step
Downloads, folder zips, the diagnostics download and the service worker's fetches: they need a board-minted single-use
key (kosmos#8790 design note), a separate step. The relay side of the header is kosmos-relay PR 854.

## Weakest premise
That old Safari (15.x) runs the worker's fetch handler for image loads and re-requests on a same-value setAttribute.
Measured in Chromium and Playwright WebKit (a current engine), not on Safari 15, which cannot be run here. The worker's
retry sends no Origin in both engines, and the relay's exact own-Origin arm would also accept one.
Also: other computers' boards' pictures are still refused on old Safari (cross-origin; the header would need a
preflight). Downloads are step 2 (dlkey-8790).
