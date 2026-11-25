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
each top-level piece there, and replace only the pieces whose markup differs from the last write's. Write whole
(replaceChildren) when prevHtml is null (the empty-board and failed-poll memo resets), when the piece count changed,
or when the container's child count no longer matches what was written. Used by paintAgentListNow (both memo-guarded
writes, new ALIST_PARTS) and setGridHtml (new GRID_PARTS).

## Tests
- Browser check render-board-patch-9094 (gated.txt): a new picture for alpha replaces alpha's row and card; beta's
  row and card stay the same nodes; polls counted; a new agent still paints. Red control: patchBoardHtml forced whole.
- Page pins updated: web.board-memo-8990.test.js (writer shapes, plus the whole-write conditions),
  web.board-empty.test.js, browser-checks-reason-grep.test.js (emit site).
- Other checks that repaint (render-star-6719, render-federation-invite-4649, render-ownseal-4658,
  render-working-pulse-3956, render-teamcreate-4557) reset the memo to null first, which still forces a whole write.

## Weakest premise
That no code puts per-row state on a row node expecting the next full rewrite to clear it. Under the patch an
unchanged row keeps such state, as an unchanged list already did under #8990.
