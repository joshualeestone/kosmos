# The room's code-block split reads fences like the store and pjRich (kosmos#3685)

Filed from #3679's review loop: `pjBody` (the room's code-block split) read a fence three ways
differently from `storeText` and `pjRich`: column 0 only, exactly three backticks, and a backtick
allowed in the info string. So in the room an indented fence under a list item drew its code as
prose (a `# comment` became a heading), a four-backtick fence broke, and a closer with an info
string closed a fence.

## Call
- Replace `raw.split(/^```([^\n]*)$/m)` with a line scan using the same rule as the store and
  pjRich: leading spaces or tabs, three or more backticks, no backtick after them, closed only by
  a bare run at least as long.
- Cut segments at the same character offsets the split used ([prose, openInfo, code, closeInfo,
  prose, ...]), so a column-0 three-backtick fence renders byte-identically. Measured: a fuzz of
  14,857 inputs of that shape (including CRLF) against main's pjBody, 0 differences; a control
  run shows the intended differences on indented and four-backtick fences.
- An indented fence's opener indentation comes off each code line, up to that much (CommonMark).
- An unclosed fence still leaves the whole message as prose, as before.

## Rejected
- Reusing pjRich's fence loop for the room: pjBody's output (figure/pre, the path-shaped
  infostring label, no `<br>` at the seams) is pinned by existing checks; changing the shape is a
  bigger change than the card.

## Weakest premise
The fuzz covers the shape both readers agree on, generated from a fixed vocabulary of lines;
it cannot prove identity on inputs outside that vocabulary.

## Verification
- web.pjbody-fence-3685.test.js: byte-identical column-0 case (pinned to main's measured output),
  indented fence under a list, four-backtick fence, info-string closer, inline span and unclosed
  fence, CRLF with a path label. main's pjBody reds four of six (the other two pin unchanged
  behaviour).
- render-richtext-room-2239.js: a Layer 1 arm for a fence nested in a list item (82/82).

## Review pass 1 (opus)
- WARNING fixed: each prose segment started a fresh list stack, so an item after a fence
  nested in a list lost its depth (the card's main shape). pjBody now passes one stack to every
  pjProse call, and a fence opener that is not indented under the open list ends it, as any such
  line does inside pjProse, so a column-0 fence still starts a new list. The fuzz against main
  still shows 0 differences on the shared shape (14,904 inputs). Tested; removing the shared
  stack or the reset reds it.
- NITs fixed: the `open` comment names its real fields; the header no longer claims every
  surface reads fences identically (pjRich draws an unclosed fence as code, pjBody keeps it
  prose); the opener's indent is stripped (see pass 2 for how a tab counts); the CRLF test pins the
  text after the fence.
- Recorded: on CRLF input a `\r` can remain at the ends of code lines, as it did on main. Room
  text is normalised by the store before it gets here.

## Review pass 2 (sonnet)
- No blockers. Mutation-tested five arms (shared list stack, dedent, backtick in info string,
  closer length, CRLF closer), each red; XSS probes escaped; column-0 output identical to main.
- WARNING fixed: the dedent cut the opener's indent by characters, so a tab opener took one
  character off a four-space code line, while openWidths (two lines above) counts a tab as 4.
  The cut is now in columns, a tab as 4 (the store's STORE_TAB), and a tab wider than what is
  left of the cut keeps its remainder as spaces. Low reach on the room path, since the store
  turns tabs into four spaces before a message is kept. Tested (four arms); cutting by
  characters again, or counting a tab as 1, each reds it.
