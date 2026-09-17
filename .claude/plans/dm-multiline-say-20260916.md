# dm-multiline-say (#3208) - direct-agent composer accepts multi-line messages (Josh 6.72)

## The ask (Josh, #chaoskosmos-design)
In direct agent messaging, the user's own messages don't respect formatting: paragraph breaks compress to one text line. Josh guessed rich text might be wired for the agent side only.

## Root cause (measured, not guessed)
Both sides of the DM already render through the same path: `dm mine` and `dm theirs` both use `pjRich(pjWords(m))`, and `.dm-b` is `white-space: pre-wrap`. The send handler only `.trim()`s (keeps internal newlines) and the store keeps paragraph breaks (#1927). The ONE blocker was the input element: the "Talk to X" composer `#d-say` was `<input type="text">`, which strips newlines by construction, so a paragraph break never reached the store. The project room composer `#pj-post` is already a `<textarea rows=1>` that handles this.

## The change (web/index.html)
- `#d-say`: `<input type="text">` -> `<textarea rows="1">` (mirrors `#pj-post`; it sits in `.dmbar.composerbox`, so the `.composerbox textarea.cinput` CSS + `.cinput` min/max-height apply).
- keydown handler: added `if (e.shiftKey) return;` so Shift+Enter inserts a newline and only a bare Enter sends, preserving the existing IME rule (`isComposing`/keyCode 229).
- input handler: added `pjGrowComposer(e.target)` so the box autosizes.
- The three programmatic `#d-say.value` writes now regrow the box (the #1303-C rule): the draft restore (`pjGrowComposer` after), the clear-on-switch (`pjComposerReset`), and the clear-after-send (`pjGrowComposer`). The Terminal box (`#d-term-say`) is left as an input (out of scope).
- Disabled-dimming: the `.dmbar` disabled rule was `input`-only, so once `#d-say` became a textarea a disabled (agent-off) composer stopped looking closed. Added a `.dmbar textarea[disabled]` arm so it stays at opacity .5 (the "A CLOSED BOX HAS TO LOOK CLOSED" intent, #991). Same input-only-selector class the file warns about at the `.composerbox textarea.cinput` note.

## What "finished" looks like
- `#d-say` is a textarea; typing/pasting a multi-line message keeps its paragraph breaks; Enter sends, Shift+Enter newlines; the box grows and resets to one line after send; the sent bubble renders the paragraph breaks.

## Tests
- docs/browser-checks/render-dm-multiline-3208.js (new, self-booting): asserts textarea, newline preservation, Enter/Shift+Enter split, autosize + reset, and multi-line render in `.dm-b`. 11 checks pass. Negative control: on the pre-fix `<input>`, 4 assertions FAIL (tag INPUT, newlines 0, autosize, Shift+Enter) and PASS after.

## Collision
Coordinated with Angel: his #3206 (branch wash-tokens-3206) touches only :root token defs + the 8 wash lines + a test; disjoint from the composer (#d-say ~8451, handlers ~42073-43600). No overlap. Merge order: whoever first, the other rebases.

## Weakest premise
That Josh's complaint is the user-side composer, not the agent side. Measured: both sides use the same render, and only the user's input element was single-line, matching his exact words ("my messages... compressing it all to one text line"). The agent side already sends rich text (#2909).
