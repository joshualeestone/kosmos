# listpatch-9094: one agent's change redraws only its own row and card (#9094)

## Report
Josh, 11-25 16:48: "the agent list seems to redraw every like 10 seconds".

## Measured (this Mac's board, 0.8.24, 20 live agents, 60 s, headless Chromium)
12 status polls; 3 whole rewrites of #alist; each replaced all 20 rows while 1 row had changed. The trigger was one
agent (claudebot): its state word flipping between working and idle (twice), and its memory ring moving (once).
0.8.22: paintAgentListNow and lrow are byte-identical in the 0.8.22 and 0.8.24 prod tarballs (reasoned, not measured
on a 0.8.22 board).

## Cause
#8990 writes #alist and #grid only when their markup changed, but any one change rewrites the whole container.
#9004 measured that a rebuilt row does not fetch its avatar again, so the cost is the visible rebuild.

## Fix
`patchBoardHtml(el, html, prevHtml, prevParts)` in web/index.html: parse the new markup into a template, serialise
each top-level piece there, and match pieces to the last write's by `data-agent` (unkeyed pieces, such as headers, by
their order among themselves). A matched piece with the same markup keeps its node. Of the kept nodes, the longest run
already in the new order stays put and only the others are moved (insertBefore), so an agent changing place under a
sort or a star moves alone, up or down. Written whole (replaceChildren) when prevHtml is null (the memo resets), when
the container's child count is not the number of pieces last written (another writer), or when an agent key repeats.
A changed piece count is patched, not written whole. Used by paintAgentListNow (ALIST_PARTS), setGridHtml
(GRID_PARTS) and My Agents (MY_AGENTS_PARTS).

## Tests
- Browser check render-board-patch-9094 (gated.txt): a new picture for alpha replaces alpha's row and card; beta's
  row and card stay the same nodes; polls counted; a new agent still paints. Red control: patchBoardHtml forced whole.
- Page pins updated: web.board-memo-8990.test.js (writer shapes, plus the whole-write conditions),
  web.board-empty.test.js, browser-checks-reason-grep.test.js (emit site).
- Other checks that repaint (render-star-6719, render-federation-invite-4649, render-ownseal-4658,
  render-working-pulse-3956, render-teamcreate-4557) reset the memo to null first, so they take the whole-write path.
- Browser check arms: 1 one change (only alpha redrawn), 2 a star moves gamma up (alpha and beta not even detached),
  3 un-star moves gamma down (same), 4 a new agent paints. Red controls in a queued job (round 2): always whole fails
  6, positional matching 4, moving every kept node 2.
- web.board-patch-9094.test.js (review 3): the real patchBoardHtml on a fake DOM. One change, a move up, a move
  down, the whole-write paths, and 400 seeded random runs (moves, inserts, removals, changes, headers, shuffles):
  order right, unchanged rows keep their node, moves equal kept minus their longest in-order run. Red on all three
  mutants (4 of 5 each).

## Weakest premise
That no code puts per-row state on a row node expecting the next full rewrite to clear it. Under the patch an
unchanged row keeps such state through other agents' changes, as an unchanged list already did under #8990. The
fed sections (#alist-fed-own, #alist-fed-outside) hold in-place focus and busy state and are re-found by
fedRefocusRail; keeping them is the intent, and no check yet exercises a patch beside an in-place edit.
