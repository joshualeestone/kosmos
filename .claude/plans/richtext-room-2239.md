# #2239: rich text renders in the project ROOM activity thread

## The bug (Josh, 0.6.35 fresh install, item 15)
"how I had the agents test paragraph breaks and font controls: heading, italics,
bold ... and it doesn't render." Two pjRich surfaces (talk thread `.dm-b`,
project message list `.pj-msg-text`) DO render restricted markdown. The project
ROOM activity thread (`pjRoomRow` -> `.msg-b` -> `pjRoomBody` -> `pjBody` ->
`pjLinkPaths` -> `pjInline`) only escaped + autolinked. That surface, where you
watch agents work a project, is exactly the one #2067 deferred to "its own PR".

## Root cause is TWO halves (both needed, proved by measurement)
1. RENDERER: the room prose path did no inline markdown or line blocks.
2. STORE: room posts were persisted via `chat.cleanMessage` (one flat line),
   so paragraph breaks were destroyed BEFORE any renderer saw them, and a
   `#`-leading multi-paragraph message collapsed onto one line. #1927 had
   already switched the DIRECT thread's store to `storeText` (keeps paragraph
   breaks); the room store was never moved. Shipping the renderer alone would
   MIS-render a flattened `#`-leading message as one giant heading (a new
   regression), so both halves must land together.

## What changed
- web/index.html:
  - `pjRichSpans(seg, names)`: optional `names` adds a held "Show me" chip pass
    (mirrors the URL-autolink hold, so a chip is inert through emphasis:
    `**notes.md**` bolds the chip). pjRich still calls with no names ->
    `.dm-b`/`.pj-msg-text` output byte-identical.
  - new `pjProse(text, names)`: fence-FREE rich prose (heading/list/hr as inline
    spans + `pjRichSpans`), lines joined with `<br>`, leading/trailing empty
    lines trimmed. NO `>` blockquote branch on purpose: the room owns a distinct
    server-supplied quote (`m.quotes` -> `.quoteb`) and web.quoteb asserts a bare
    `>` stays literal.
  - `pjBody` hands each prose segment to `pjProse` instead of `pjLinkPaths`;
    fenced blocks keep pjBody's richer figure/codeb/codesrc rendering.
  - CSS: `.msg-b` added to the `.mdh/.mdc/.mdcb/.mdq/.mdli/.mdhr` selectors.
- engine/messages.js (`sendPost`): stored text + the #460 quote offsets now use
  `chat.storeText(text)` (paragraph breaks kept); `cleanMessage` still drives the
  delivered pane envelope, @mention detection, spill and validation. Quotes are
  computed against the SAME stored string so their char offsets index it.
- Tests/guards: new browser-check `docs/browser-checks/render-richtext-room-2239.js`
  (Layer 1 in-page pjBody/pjProse battery + safety controls; Layer 2 real room
  painted via the live server, DOM + computed CSS, both themes). Reconciled all
  four wiring guards (README index, runner loop, reason-grep EXPECTED_SITES 44->45,
  selectors unchanged). `server.test.js` bodyFn prelude lifts pjProse+pjRichSpans.

## Weakest premise
I have not seen Josh's exact screenshot (10.18.05 AM). I inferred the surface
from "had the agents test" + the measured fact that the two pjRich surfaces
render his forms and only the room does not. If his shot were a `.dm-b`/
`.pj-msg-text` bubble, the bug would be elsewhere (CSS reset - ruled out; no
strong/em reset exists). Building the room fix regardless, because that surface
is genuinely unbuilt and is the one his description points at.

## Verification
Full root suite (2172) + engine (2421) green. New browser-check: 66/66 both
themes, drives the shipped functions + real painted room, with dangerous-answer
controls (a `<script>` proven inert in the bubble).
