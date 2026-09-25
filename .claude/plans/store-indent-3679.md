# Stored posts keep their indentation (kosmos#3679)

Angel, 2026-09-24: `engine/chat.js` `storeText` turned every run of spaces or tabs into one
space, at the start of a line and inside ``` fences too, so an agent's code sample or nested
list arrived flat. Doctrine now tells agents rooms show fenced code (#10) and how to send
multi-line messages (#3678), so this is newly reachable.

## Measured first
- `storeText` is the one store shape for both the room (`messages.js` post) and the direct
  thread (`appendMessage`, `messageProblem`). The pane is a separate path (`cleanMessage`,
  one line) and is unchanged.
- `CONTROL` refuses a tab, so a tab cannot simply be kept.
- The room renderer (`pjProse`/`pjBody`) puts fenced code in a `<pre>`, so indentation there
  shows as soon as it is stored. Both renderers (`pjProse`, `pjRich`) drew every list item
  flat whatever its indentation, so a stored nested list would still have looked flat.

## Calls
- STORE: CRLF/CR to LF; a tab to four spaces; inside a ``` fence every line kept as written
  (trailing spaces dropped); outside, leading indentation kept, a run inside a line becomes
  one space, trailing spaces go, three or more newlines become one blank line; the ends trimmed.
- RENDER: a list item's leading whitespace gives it a depth class (`mdli-d1..3`, two spaces a
  level, a tab four), styled as a left margin on all four surfaces. A top-level item's markup
  is byte-identical, which the older richtext checks pin.

## Rejected
- Keeping tabs: `CONTROL` refuses them, and widening `CONTROL` would let a tab reach a pane
  path that has not been measured for it.
- Rendering nested lists as real `<ul>` trees: every list item is a span joined by `<br>`
  today, and a tree would be a renderer rewrite for one card.
- Changing `engine/you.js`'s own multiline clean: a different field with its own tests.

## Weakest premise
The ends are still trimmed, so a message whose FIRST line is indented loses that one line's
indentation. Code needs a fence to render as code anyway, and a nested list does not start a
message, so this was kept rather than special-cased.

## Verification
- engine/store-indent-3679.test.js: the card's example round-trips; fence contents kept;
  outside collapses still happen; tab to spaces and sendable; unclosed fence; ESC still refused
  and the pane copy still one line; the direct thread record. The old `storeText` reds six of
  seven (the seventh guards the unchanged pane path).
- web.list-depth-3679.test.js: both renderers, depth 1 to 3 and the cap, numbered items, a tab,
  the CSS on every surface. `pjListDepth` returning '' reds six of seven.
- docs/browser-checks/render-richtext-room-2239.js: a Layer 1 nested arm, and Layer 2 posts a
  nested list and indented code through the real server and asserts the painted indent and the
  code's spaces. The old `storeText` reds both Layer 2 arms in both themes.

## Review pass 1 (opus)
- The first validation failed on #1732's Windows-coupling audit: the fence regex held a literal
  backtick, which that scanner reads as opening a template string, so a later comment counted as
  code. The regex spells it `\x60{3}`.
- `messageProblem` measured MAX_TEXT on the stored form, so kept indentation (a tab is four
  spaces) could refuse a DM the room accepts. It now measures the one-line form, as the room
  does; a test pins both sides, and the old check reds it.
- Stale comments fixed in render-talk.js, messages.js and the messageProblem doc.
- Recorded, not changed: the room's code-block split (`pjBody`) takes a fence only at column 0,
  while the store (and `pjRich`) accept an indented one. An indented fence in the room is kept
  verbatim by the store and drawn as prose, so it shows its spaces under pre-wrap. Bounded, and
  aligning the renderer is a separate change.
- Recorded, not changed: depth is two spaces a level, so four-space or one-tab nesting draws two
  levels deep; and an inline item's margin indents only its first line when it wraps. Both are
  presentation, and a real `<ul>` tree is the fix for either.
