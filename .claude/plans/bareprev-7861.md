# bareprev-7861: a bare address the chat links gets a preview, https first

Card: kosmos#7861 (Josh, 11-03 09:58 CST). Owner: Ice Cream Kitty.

## The cause
The page links a bare address (web/index.html pjBareWeb/pjBareSplit, kosmos#7239), but the board picked the link to
preview with engine/unfurl.js firstLink, which matched only http:// and https://. So joshualeestone.com was a link
with no preview, and http://joshualeestone.com had one.

## The change (final state)
- engine/unfurl.js bareWeb and bareSplit: a copy of the page's word rule, so the board recognises a bare address
  exactly as the page does. firstLinkInfo(text, opts) returns the first link, bare or explicit, as { url, bare }; a bare
  one is its https:// address. firstLink is gone (the server was its only caller).
- The bare scan is CONSERVATIVE: whole words between whitespace only, and none at all in a message holding any of
  ` [ ] | (code, markdown links, tables), in one past 8000 characters, or (server) in a row carrying files. Each of
  those changes which words the page links; matching the page's rules for them one by one kept finding new edges in
  review rounds 1 to 7 (unclosed fences, text glued to a link, table cells past the header, a link whose label holds a
  |, a link longer than a bounded pattern), so the scan stays out of them. Missing a bare preview is how every bare
  address was before; previewing a word the chat shows as text is the error this rules out.
- previewBare: https first; http only when https was not reached (no connection, too slow, or a 5xx). A 4xx is the
  site's answer, an answer with nothing to show stays an answer, and the address gate is never sidestepped (a private
  address is refused before any fetch, over either scheme). A page the http address redirects to on another host (www.
  aside), over http or https, is not kept. The card opens the https:// address, never plain http.
- Cache: when https answers, the bare address reads the typed-link entry (one slot); only an http fallback's outcome is
  kept under its own key ('b:'), so a typed https:// link never shows a preview read over http.
- server.js withPreviews: firstLinkInfo, then peekBare/warm(url, { bare: true }) for a bare link and peek/warm as before
  for a typed one. GET /api/messages, which no screen reads and which serves every agent's whole record, passes
  { bare: false }, so the change does not widen what an unread route fetches.

## The phone
Measured: the iPhone chat makes a bare address a link (NSDataDetector) but draws no preview card for ANY link. A missing
feature, not this bug: its own card, #7864, which I take after this merges.

## Decided
- The rule is copied, not shared: the page cannot require an engine file. Parity is tested against the page's own
  functions, lifted.
- Weakest premise: that "not reached" (connect failure, timeout, a 5xx) is the right trigger for http. A site that
  answers https with a broken page and http with a good one stays unpreviewed (today's behaviour).
- What is guaranteed, and tested: a bare address previewed is always a link the page's pjRich draws for that text, and
  (generated messages) one the project room's pjBody draws. Stated exceptions, outside those renderers, not tested: a
  word the project room draws as a file chip because a project file has that name; an agent whose display name is
  itself host-shaped (the page drops a "Name:" prefix, pjDropSelfName); a room message split at quote offsets inside a
  word. Each needs a host-shaped name or a cut inside a word.
- NOT guaranteed: that the bare address previewed is the FIRST link the page draws (>x.com then https://e.org previews
  e.org). The explicit scan's old behaviour (it can preview a typed http link the page shows as text, e.g. in quotes) is
  unchanged by this card.
- Accepted: a network that can break https can supply a card's title and image over http for the same host; the card
  still opens https and the address gate still applies. A typed https://x and a bare x on the same poll can fetch
  https://x twice at once (separate in-flight keys). The page's own pjRich fast-path check uses an unbounded markdown
  pattern in the browser; that predates this card.

## Verified
- engine/unfurl.bare-7861.test.js (17 tests): word parity with the lifted pjBareWeb/pjBareSplit; whole-message parity
  with the lifted pjRich (9 functions) and pjBody, on a fixed list of 51 messages and 20000 generated ones (fixed seed);
  the https-then-http order and every fallback rule; a timing test on inputs just under the 8000-character cap.
- server.unfurl-bare-7861.test.js (6 tests) through GET /api/agent/<name>/thread, the route the agent page polls, and
  one on GET /api/messages; server.fedmsg-3311.test.js covers a bare address in words from outside.
- Mutations, each run and the file restored after: the server back to explicit-only links (both bare route tests red);
  the bare flag dropped from warm (bare route tests red); no backtick rule, no | rule, no [ ] rule (parity red, naming a
  message); each earlier round's unfurl.js put back (parity red on that round's finding); the server ignoring a row's
  files; the cross-host check removed, for http and for https; bare previews put back on GET /api/messages. Each turned
  exactly its own test red.
- engine.reachable, unfurl.test.js, web.links-everywhere, server.fedmsg-3311, win32-separator-guard: green.
