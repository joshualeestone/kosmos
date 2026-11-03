# bareprev-7861: a bare address the chat links gets a preview, https first

Card: kosmos#7861 (Josh, 11-03 09:58 CST). Owner: Ice Cream Kitty.

## The cause
The page links a bare address (web/index.html pjBareWeb/pjBareSplit, kosmos#7239), but the board picks the link to
preview with engine/unfurl.js firstLink, which matched only http:// and https://. So joshualeestone.com was a link
with no preview, and http://joshualeestone.com had one.

## The change
- engine/unfurl.js: bareWeb and bareSplit, a copy of the page's rule, so the board previews exactly what the chat
  links. firstLinkInfo(text) returns the first link, bare or explicit, as { url, bare }; a bare one is its https://
  address. Code in backticks is blanked before the bare scan (the page holds code before it links). firstLink is gone:
  the server was its only caller.
- previewBare: https first; http only when https was NOT REACHED (could not connect, took too long, or answered an
  error status). An answer that came back (not a page, nothing to show) does not fall back, and the address gate is
  never sidestepped (a private address is refused before any fetch, over either scheme). A preview fetched over http is
  kept under the https address, which is the one the payload helper peeks.
- server.js withPreviews: firstLinkInfo, and warm(url, { bare }).
- An explicit https:// link the person typed is NEVER fetched over http (tested).

## The phone
Measured: the iPhone chat makes a bare address a link (NSDataDetector) but draws no preview card for ANY link. That is
a missing feature, not this bug, so it is its own card, #7864, which I take after this merges.

## Decided
- The rule is copied, not shared: the page cannot require an engine file. The parity test lifts the page's own two
  functions and runs them beside the engine's on one list of words, so the two cannot drift silently.
- Weakest premise: that "not reached" (connect failure, timeout, error status) is the right trigger for http. A site
  that answers https with a broken page and http with a good one stays unpreviewed. Cost: what happens today.
- Not done: the cited-file chip. The page keeps a project file named like a host (brand.ai) as a file chip; the board
  could still preview such a name. The ambiguous-ending rule already keeps one-dot .ai/.dev/.me/.co names out, so the
  residual is a file named like a multi-label host.

## Verified
- engine/unfurl.bare-7861.test.js (8 tests) and server.unfurl-bare-7861.test.js (4, through GET /api/messages).
- Mutations: the server back to explicit-only links turns both bare route tests red, controls green; the bare flag
  dropped from warm turns only the http-fallback route test red.
- engine.reachable, unfurl.test.js, web.links-everywhere, server.fedmsg-3311, win32-separator-guard: green.
