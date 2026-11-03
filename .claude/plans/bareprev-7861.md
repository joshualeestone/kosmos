# bareprev-7861: a bare address the chat links gets a preview, https first

Card: kosmos#7861 (Josh, 11-03 09:58 CST). Owner: Ice Cream Kitty.

## The cause
The page links a bare address (web/index.html pjBareWeb/pjBareSplit, kosmos#7239), but the board picks the link to
preview with engine/unfurl.js firstLink, which matched only http:// and https://. So joshualeestone.com was a link
with no preview, and http://joshualeestone.com had one.

## The change
- engine/unfurl.js: bareWeb and bareSplit, a copy of the page's word rule (pjBareWeb, pjBareSplit). firstLinkInfo(text)
  returns the first link, bare or explicit, as { url, bare }; a bare one is its https:// address. firstLink is gone:
  the server was its only caller.
- The bare scan is CONSERVATIVE (review round 1): the page's renderer (pjRich) does more before it links a word (fences,
  inline code, code touching a word, markdown links), and porting all of it would be a second renderer to keep in step.
  So a message with any backtick gets no bare scan (the explicit scan is unchanged there), and a markdown link offers
  only its target. Missing a bare preview is today's behaviour; previewing a word the chat shows as text is the error
  this rules out.
- previewBare: https first; http only when https was not reached (no connection, too slow, or a 5xx). A 4xx is the
  site's answer, an answer with nothing to show stays an answer, and the address gate is never sidestepped (a private
  address is refused before any fetch, over either scheme). Its result is kept under its OWN key ('b:'), read by
  peekBare, so a preview fetched over http is never what an https:// link the person typed shows (review round 1).
- server.js withPreviews: firstLinkInfo; peekBare/warm(url, { bare: true }) for a bare one, peek/warm as before for a
  typed one.
- Known and accepted: when the fallback is used the card's own link is the http:// address the page was read from,
  while the word in the message links to https://. A network that blocks https can then supply a preview's title and
  image over http; the preview is display only and the address gate still applies.

## The phone
Measured: the iPhone chat makes a bare address a link (NSDataDetector) but draws no preview card for ANY link. That is
a missing feature, not this bug, so it is its own card, #7864, which I take after this merges.

## Decided
- The rule is copied, not shared: the page cannot require an engine file. The parity test lifts the page's own two
  functions and runs them beside the engine's on one list of words, so the two cannot drift silently.
- Weakest premise: that "not reached" (connect failure, timeout, a 5xx) is the right trigger for http. A site
  that answers https with a broken page and http with a good one stays unpreviewed. Cost: what happens today.
- Not done: the cited-file chip. The page keeps a project file named like a host (brand.ai) as a file chip; the board
  could still preview such a name. The ambiguous-ending rule already keeps one-dot .ai/.dev/.me/.co names out, so the
  residual is a file named like a multi-label host.

## Verified
- engine/unfurl.bare-7861.test.js (10 tests), including WHOLE-MESSAGE parity: 32 messages rendered by the page's own
  pjRich (lifted with its 8 helpers); the link previewed is always the first link the page draws, and outside code
  nothing the page links goes unpreviewed. server.unfurl-bare-7861.test.js (4, through GET /api/messages).
- Mutations, each restored after: no backtick rule (E) and no label blanking (F) each turn the parity test red; the
  server back to explicit-only links turns both bare route tests red, controls green; the bare flag dropped from warm
  turns both bare route tests red (the bare key is never filled).
- engine.reachable, unfurl.test.js, web.links-everywhere, server.fedmsg-3311, win32-separator-guard: green.
