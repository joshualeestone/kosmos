# mdtable-7214: a table in a room post stays in its bubble (kosmos#7214)

## Finished looks like
An agent's room post with a markdown table (file names and 64-character hashes in code spans) stays inside its
bubble on desktop and phone, light and dark; long code spans in cells wrap in their column; plain words in a cell
still break between words.

## Cause (measured)
pjRoomBody wraps a post's words in <p>. The HTML parser closes an open <p> at a <table> (and at <div>, <pre>, a list,
a heading, <figure> ...), so `<p>...<span class="mdtablewrap"><table>` became an empty wrapper inside the <p> and the
table loose in .msg-bd, with no max-width and no scroll. Dumped from the real room: `<p>...<span class="mdtablewrap">
</span></p><table class="mdtable">`. DMs never had the <p>, which is why #718's DM tables scrolled correctly.

## Built (as of review round 2)
- pjRoomPara parses a post's body in a <template> (which does not close a <p> at a block) and writes it as the
  browser would show it, on purpose: each run of words a <p>, each block (the table's .mdtablewrap, a code block's
  figure, its path) between them. A run of only line breaks between two blocks stays raw (two tables stack with their
  blank line); at either end it goes. A run with anything but line breaks (a rule) is kept. A body with no block is
  one <p>, exactly as before.
- In room tables only, a code span over 16 characters (a hash, a path, a file name) is marked .mdc-long and may break
  anywhere, in a column of at least 10ch. Short names and flags keep their words; a table of them scrolls (#718).
- A code block that starts with a blank line keeps it (the extra newline the second parse eats).
- mobile-shots.js room-table-7214: Josh's shape injected into the room on the way to the page.

## Decided
- Wrap long tokens rather than rely on a sideways scroll: both are in place; with wrapping, Josh's table fits.
- Weakest premise: on a phone the file-name column is narrow and "catalogue-proof-final.pdf" breaks at its hyphens.
  Would change my mind: Josh wanting file names whole, which means a horizontal scroll on phones instead.

## Evidence
- render-richtext-room-2239.js: a second post in Josh's shape (no block before the table); the table is in its
  wrapper and inside the bubble, light and dark, 88 checks. With pjRoomPara forced to <p>, the wrapper check goes red
  (2). The edge check cannot fail at that window width (the hash fits), so the wrapper check is the guard.
- Root unit set 3552/3552; #2518 surface gate exit 0; sync-forced-theme --check exit 0.
- Shots: ~/work/design-shots/kosmos-7214 (4, 0 overflow, 0 errors).

## Review
- Round 1 (.claude/plans/mdtable-7214-review1.md): 1 blocker, 2 warnings, 2 nits. Approach changed:
  - pjRoomPara no longer wraps a block-holding body in div.msg-p (which restyled every post with a code fence). It
    builds the body as the browser would show it, on purpose: each run of words a <p>, each block (the table's
    .mdtablewrap, a code block's figure, its path) between them, where the parser already put a code block. A body
    with no block is one <p>. All the .msg-p CSS is reverted to main's rules. The one visible change on a code post: the
    words after a fence are now a <p> like the words before it (15px, not the 13px of loose text).
  - BLOCKER: `.mdc { overflow-wrap: anywhere }` is scoped to #pj-room tables only (DMs, the project list and task detail
    are main's again, #718), with a floor `td:has(> .mdc) { min-width: 12ch }` so a table of short names scrolls.
  - render-richtext-room-2239: a short-names table and a 393px pass; asserts the names stay whole (at most 2 pieces)
    with the table scrolling, and the hash wraps in a column of 80px or more. Red without the floor (2) and with
    pjRoomPara as a plain <p> (6).
  - Nits: the block list is now the parser's whole list; the redundant quote selectors are gone with the revert.
- Round 2 (.claude/plans/mdtable-7214-review2.md): 1 blocker, 2 warnings, 3 nits. All taken:
  - BLOCKER: two tables separated by a blank line went side by side (the line-break run between them was dropped).
    Now kept raw between blocks. WARNING: a rule beside a block was dropped. Now kept. WARNING: the 12ch floor on every
    code cell made Josh's own table scroll on a phone. Now only long code spans (> 16 characters), floor 10ch: Josh's
    shape fits at 393 without scrolling (asserted).
  - Nits: a code block's first blank line kept; the comment says the browser check is pjRoomPara's guard (the unit
    harness stubs document); Built rewritten.
  - render-richtext-room-2239: 98 checks. Each new rule red when removed: two tables stack, a rule at the end, the
    first blank line, the hash table not scrolling at 393.
