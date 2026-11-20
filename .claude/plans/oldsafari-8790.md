# oldsafari-8790: the board's pictures load on a browser with no Sec-Fetch-Site (kosmos#8790, step 1)

Finished means: on a browser that sends no Sec-Fetch-Site (Safari before 16.4), agent avatars, your picture, and image
and PDF-page previews on the board show, instead of staying refused by the computer's connector; nothing changes on a
browser that sends Sec-Fetch-Site; a picture that really fails still fails the way it did (kosmos#8636).

## Design
- One capture-phase `error` listener (boardPicFailed), registered before every other document error listener. A failed
  `<img src>` or SVG `<image href>` at this board's own origin under `/api/` is fetched ONCE through the page's own
  fetch (the kosmos#8781 wrapper adds X-Kosmos-Board-Page: 1) and shown as a blob: URL. Same URL on many rows reuses one
  blob (bounded at 300, oldest revoked).
- The failure is held (stopImmediatePropagation) while the retry runs; a refused retry, or a reply that is not an
  image, re-raises `error` on the element so kosmos#8636 and the per-image listeners see it as before.
- A picture whose address changed while its retry ran keeps its new address; a new address gets its own one retry.

## Not in this step
Downloads, folder zips, the diagnostics download and the service worker's fetches: they need a board-minted single-use
key (kosmos#8790 design note), a separate step. The relay side of the header is kosmos-relay PR 854.

## Weakest premise
That an image refused by the connector raises `error` on the element. A 401 with a JSON body does on every engine
measured here (Chromium in the browser check); old Safari itself is not available to run.
