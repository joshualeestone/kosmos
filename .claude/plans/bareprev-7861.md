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
  So the bare scan looks only at whole words between whitespace: a message with any backtick gets none (the explicit
  scan is unchanged there), a word overlapping a markdown link is skipped, and only a link that is a whole word on its
  own offers its target (review round 2: text glued to a link, evil.com[x](y.org), was split off and previewed though
  the page shows it as text). Missing a bare preview is today's behaviour; previewing a word the chat shows as text is
  the error this rules out. Review round 3: also no bare scan in a message with any | (the page reads | as a table,
  which drops cells past the header's count and splits a link whose label holds a |; both were previewed). Known misses:
  any bare address in a message with a backtick or a |, and one after a quote marker with no space (>example.com).
- Review round 4: a row carrying files gets no bare scan (the page hides a text that is only the file names, and a
  file can be named like a host); a host followed by a colon or a port ("example.com: here", example.com:8080) is no
  longer mistaken for a scheme of its own; and an http page that redirects to another host over plain http is not kept.
- Review round 5: GET /api/messages, which no screen reads and which serves every agent's whole record, previews only
  links typed with http(s) (withPreviews opts.bare false), so this change does not widen what an unread route fetches.
  The scheme check is gone: the page's own word rule (bareSplit) already refuses any word with a scheme, and the extra
  check skipped "example.com:)". An http page redirecting to its own www. host is kept (same host).
- Review round 6: the markdown-link pattern is bounded (label 500, target 2048) and a message past 8000 characters gets
  no bare scan, because this runs on every poll for every row and the unbounded pattern took 1.7 s on 50000 "[" (now
  tested under 150 ms). The same-host rule now applies whatever the final scheme: an http page sending us to ANOTHER
  host's https page is not kept either. Not changed, noted: the page's own pjRich fast-path test uses the same unbounded
  pattern in the browser; that predates this card.
- What is guaranteed, and tested: a bare address previewed is always a link the page's pjRich draws for that text.
  Stated exceptions, outside pjRich, not tested: an agent whose display name is itself host-shaped (the page drops a
  "Name:" prefix, pjDropSelfName); a room message the server splits at quote offsets mid-word; a word the room draws as
  a project-file chip. Each needs a host-shaped name or a cut inside a word. NOT guaranteed: that it is
  the FIRST link the page draws (>x.com then https://e.org previews e.org), and the explicit scan's old behaviour (it can
  preview an http link the page shows as text, e.g. in quotes) is unchanged by this card.
- previewBare: https first; http only when https was not reached (no connection, too slow, or a 5xx). A 4xx is the
  site's answer, an answer with nothing to show stays an answer, and the address gate is never sidestepped (a private
  address is refused before any fetch, over either scheme). Its result is kept under its OWN key ('b:'), read by
  peekBare, so a preview fetched over http is never what an https:// link the person typed shows (review round 1).
- server.js withPreviews: firstLinkInfo; peekBare/warm(url, { bare: true }) for a bare one, peek/warm as before for a
  typed one.
- When the fallback is used, the card's own link stays the https:// address the word opens (or the https:// address
  the http page redirected to), never plain http (review round 3). Accepted: a network that can break https can then
  supply the card's title and image over http; the card still opens https, and the address gate still applies.
- Not changed, noted: a typed https://x and a bare x on the same poll can fetch https://x twice at once (separate
  in-flight keys); a bare preview can hold up to three of the 200 cache slots. Both bounded, neither wrong.

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
- engine/unfurl.bare-7861.test.js (16 tests), including whole-message parity against the page's own pjRich (lifted with
  its 8 helpers): a fixed list of 49 messages and 20000 generated ones (fixed seed); a bare address previewed is always
  a link the page draws, and (generated messages) a link the project room's pjBody draws too. server.unfurl-bare-7861.test.js (6, through GET /api/agent/<name>/thread, the route the agent
  page polls; one checks GET /api/messages fetches no bare address).
- Mutation G (round 2): the round-1 unfurl.js put back in place turns both parity tests red, each naming a message.
- Mutation H (round 3): the | rule removed turns both parity tests red; the generator (now with table pieces) found a
  second table shape on its own. The generator's floor is 1000 bare cases (1429 measured with | pieces in).
- Mutations M and N (round 6): the unbounded, uncapped pattern turns the hostile-message test red (1722 ms); the
  same-host rule limited to http again turns the http-to-other-https test red.
- Mutation L (round 5): bare previews put back on GET /api/messages turns its test red.
- Mutations J and K (round 4): the server ignoring a row's files turns the file-named-host route test red; the
  cross-host check removed turns the redirect test red.
- server.fedmsg-3311.test.js: a bare address in words from outside is not fetched either (its mutation, the external
  skip removed, goes red, though the test's existing http case would too).
- Mutations, each restored after: no backtick rule (E) and no label blanking (F) each turn the parity test red; the
  server back to explicit-only links turns both bare route tests red, controls green; the bare flag dropped from warm
  turns both bare route tests red (the bare key is never filled).
- engine.reachable, unfurl.test.js, web.links-everywhere, server.fedmsg-3311, win32-separator-guard: green.
