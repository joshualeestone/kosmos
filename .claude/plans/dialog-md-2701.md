# #2701: render markdown tables and size heading levels in the dialog message renderers

**Branch:** `dialog-md-2701` · **Card:** kosmos#2701 (josh-review, from Josh's design-channel
observation 2026-09-10; part of the STYLES backlog Splinter routed to me)

## Josh's report

> "It looks like tables don't render correctly in the dialog box and neither do emojis at different
> sizes."

## What I found (measured in the code)

The dashboard has TWO message markdown renderers with the same two gaps:
- `pjRich` (web/index.html) - the talk/DM dialog (`.dm-b`) and the project message list
  (`.pj-msg-text`).
- `pjProse` (via `pjBody`) - the project ROOM activity thread (`.msg-b`).

Both:
1. **Have no table branch.** A line like `| a | b |` matched none of hr/heading/quote/list, so it
   fell to the inline renderer and the pipes rendered as literal text. That is "tables don't render
   correctly".
2. **Collapse all six heading levels to one `mdh` class** (`/^#{1,6}/` -> `<span class="mdh">`), and
   the CSS gave `.mdh` a single `font-size: 1.0625rem`. So `# H1` and `###### H6` (and any emoji in
   them) rendered at the SAME size. There is no emoji-specific rendering code - emojis are plain
   unicode that inherits the surrounding font-size - so "emojis at different sizes" is, in code
   terms, "text/emojis in different heading levels do not render at different sizes".

## The fix

- **A shared GFM table parser** (`pjTableCells` / `pjTableAligns` / `pjTableHtml`) used by BOTH
  renderers, so the parse lives in one place. Detection is strict: a line is a table header only
  when the NEXT line is a valid separator (`| :-- | --: |`), so a stray `|` in prose never becomes a
  table. Cells carry inline markdown via `pjRichSpans` (so code/links/emphasis survive) and are
  escaped (no HTML injection through a cell). Alignment colons map to `text-align`.
- **Heading level emitted** (`<span class="mdh mdh1">` .. `mdh6`) in both renderers, and CSS sizes
  them (a gentle ramp; `mdh3` keeps the old 1.0625rem so the common case is unchanged).
- **Table CSS**: the table is wrapped in a `.mdtablewrap` inline-block scroll container (the
  `#usage-table` pattern) carrying `max-width:100%` + `overflow-x:auto`, so a wide table (a long
  URL / inline-code token in a cell) SCROLLS inside the container rather than widening the message
  bubble; the wrapper flows in the renderers' inline (`<br>`-joined) output like `.mdhr`'s
  inline-block, and `.mdtable` itself keeps only `border-collapse` + `font-size`. (An earlier draft
  put `inline-table`/`max-width` on `.mdtable` directly, which asserted "scrolls" without an
  `overflow` to make it true; the wrapper is the fix.)
- **pjRich fast-path**: a message containing `|` now takes the slow path (where table detection
  runs). A single-line pipe message stays byte-identical (`pjRichSpans` escapes it the same); a
  multi-line one renders its breaks as `<br>` under the same pre-wrap, so no visible change.

## The scope call I made, and the weakest premise

"tables don't render correctly" is unambiguous and clearly fixed. **"emojis at different sizes" is
my best reading of a screenshot I cannot see.** The strongest code-grounded interpretation is the
heading-level collapse above, and fixing it is *objectively correct markdown fidelity* regardless of
Josh's exact wording (a renderer that ignores heading level is incomplete), so it is low-regret. I
kept `mdh3` at the current size to minimise surprise, and this is a josh-review card, so Josh
confirms in the running app. If the emoji issue was something else entirely (e.g. a specific
surface), it is a quick follow-up; the table fix stands regardless.

I fixed BOTH renderers because "the dialog box" could be the talk/DM dialog (pjRich) or the room
(pjProse), and both had the gaps.

## Verification

- `web.dialog-md-2701.test.js` (new): lifts the REAL pjProse and pjRich and asserts, for EACH
  renderer, a table renders as a real `<table class="mdtable">` (not piped text), heading levels
  emit mdh1..mdh6, a stray pipe stays text, a `---` rule below a pipe line stays a rule (not a false
  table), and a cell escapes HTML (no injection). 10 tests (5 per renderer).
- Extended the two shipped render browser-checks (headless, both themes, run under pw-runtime):
  - `render-richtext-room-2239.js` (pjProse/.msg-b): the shipped function renders a table + distinct
    heading levels in the page, AND the PAINTED room shows a real table element and the level-1
    heading computes LARGER than the level-6 (20.8px > 14px) - the "different sizes" proven by
    computed CSS. Also updated its existing heading assertions to the new `mdh mdh1` class. 74 checks,
    0 fail.
  - `render-richtext-2067.js` (pjRich/.dm-b): the same table + heading-level assertions, and updated
    its heading assertions to the new class. 120 passed, 0 problems.
  Registration unchanged (extended existing checks; the reason-grep count is per finding-emit SITE,
  which is unchanged).
- Existing renderer tests (web.agent-answers, web.links-everywhere, web.quoteb, web.quoted-line-986)
  and the browser-check meta-tests (selectors/reason-grep/indexed) all still green.

## Weakest premise (restated)

That the heading-level collapse is what Josh meant by "emojis at different sizes". If not, the
heading-size fix is still a correct markdown-fidelity improvement, and the ambiguous half is a
follow-up on a josh-review card he will see live.
