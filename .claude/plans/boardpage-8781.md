# boardpage-8781: the board page's own fetches say so, for browsers with no Sec-Fetch-Site

kosmos#8781 (a customer's Safari 15.6.1 on a Kosmos Cloud box, 2026-11-19): the board's half. The connector's half is kosmos-relay branch oldsafari-8781.

## The problem
Safari before 16.4 sends no Sec-Fetch-Site. The connector gives the board token only for same-origin or none, so every board read from such a browser reaches the board with no token, gets 403, and the page shows "This page is signed out" forever. Measured on the coordinator's logs: Origin is sent on that Safari's POSTs but on none of its GETs.

## The change (web/index.html, the one fetch wrapper)
`fetchReadingRefusals` adds `X-Kosmos-Board-Page: 1` to every same-origin request (relative, absolute to this origin, or a URL object). Not to another origin (the page reads other computers' boards credentialed, and a custom header there would force a preflight). A Request object, or anything it cannot read, goes out exactly as it was. The page makes its data reads through fetch (no XHR, EventSource, beacons or Request objects in it). Not its images: agent avatars are `<img src="/api/agent/<name>/avatar">`, which cannot carry a header, so an old Safari may show them broken if that route needs the board token (fails closed; recorded on the card).

The connector (oldsafari-8781) then gives the token to a request with no Sec-Fetch-Site only for an exact own Origin, or for no Origin plus this header. Another site cannot put a custom header on a link, an image, a form or a redirect, and a cross-site fetch that asks to is preflighted, which nothing approves. The Referer was rejected as a signal (review 1 there): a redirect bounce from a link on this page carries it.

## Tests
`web.boardpage-header-8781.test.js` runs the page's real wrapper, sliced from web/index.html: the header on relative, absolute and URL reads of this board; none, and the init untouched, for another computer's board; the page's own method, body and headers kept; no doubled header; a Request-like input left alone. Red-capability: without the line that applies it, "a relative read" fails (measured). `server.stepupbutton-6616.test.js` (the wrapper's other tests) still passes.

## Known limits (fail closed)
- Images (agent avatars) and the service worker's own fetches (web/sw.js) do not pass through the wrapper, so on such a browser avatars may show broken and the offline shell may not warm.

## Weakest premise
That Safari 15 sends a custom header on a same-origin fetch GET without a preflight. Same-origin requests are never preflighted in any browser. Proven against a recording stub; preflight behaviour was not measured in any engine, and not in a real Safari 15.

## Review log
- Review of the connector half (iteration 2 there) found the image gap above; the wrapper's comment and this plan are corrected.
- Iteration 1 (opus): WARNING, the "not doubled" assertion could not fail without its guard (set replaces): it now pre-sets "0" in lower case and asserts the caller's value is kept (a mutant without the guard fails it, see below). WARNING, untested input shapes: protocol-relative to another host and to this one, data:, about:, a Headers object, pairs, all asserted. NITs taken: the comment says a same-origin init's headers become a Headers object, says "nothing on this computer approves", and names the service worker's fetches as not covered (also under Known limits); the plan's measurement claim says a recording stub, not a real engine.
