# unreadedge-4418: the gold unread edge off everywhere (Josh, 2026-09-28)

Josh does not want the gold unread line (#3743's edge) popping in on new agent messages, "yet".

## Done looks like
- No agent message is ever marked data-unread (the only thing the edge's CSS draws on), in DMs, project rooms
  and the setup guide: unreadEdgeApply, the one place that marks, returns at once while UNREAD_EDGE_ON is false.
- web.unread-edge-off-4418.test.js runs the real unreadEdgeApply on a thread with an unread message and asserts
  nothing is marked; its CONTROL turns the switch on and the same message is marked.
- render-unread-edge-3743.js (it asserts the edge) is unwired with a stated reason (NOT_WIRED, README note) and
  goes back into gated.txt when the switch does.
- web/whats-new.json is Baron's (branch wnunread-4418); not touched here.

## Decisions
- A switch rather than ripping the code out: under the 0.7.07 freeze the smallest change is safest, a git revert
  of #3814/#4293 conflicts with later work, and "yet" means it may come back (one line).
- The bookkeeping (backlog counts, #3743's data-mid on rows) stays; with the switch off it marks nothing.

## Weakest premise
That data-unread is the only way the edge is drawn: checked by grep (only unreadEdgeApply sets it).
