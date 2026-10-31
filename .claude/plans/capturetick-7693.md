# capturetick-7693: pane captures stop holding the board when this computer is busy

Card: kosmos#7693 (feedback 10-31: community CLI writes give up after 20 s with the too-busy answer).

## Why
Measured on our board 10-31: `/api/health` missed 30 s four times running while a control board answered in under 1 ms; the main
thread was in blocking child processes under Array.map; 120 of 132 sampled children were tmux. `snapshot()` runs one blocking
`tmux capture-pane` per agent on every `/api/status` and every `safeRoster()` (165 call sites), uncached.

## Finished looks like
- GET /api/status gathers its pane captures with execFile, then builds that one snapshot from them, so the event loop answers
  other requests (and /api/health) while tmux is slow.
- Every other snapshot() is unchanged: a live blocking read, because those callers act on what they read.
- Nothing is kept: gathered text lives only for the one synchronous snapshot built from it. Text whose capture was asked for over
  3 s ago, a failed capture, or a pane the gather did not see gets the live read.
- A second status request during a gather shares it.
- Tests: built from the gathered text; plain snapshot() untouched (control); no text outlives its snapshot; too-old text not used;
  failure falls back; requests share; a capture seam bypasses it; the route uses it.

## Decided
- Round 1's design is REJECTED and removed: an adaptive keep of pane text up to 4 s old, for every snapshot(). Review found a
  BLOCKER that met this plan's own test: kept text is not marked remembered, so code that acts on snapshot() could release held
  lines into a capped session, or type onto a trust dialog after a restart. Marking it would have stalled the acting sweeps. Reading
  it as a design error, not a patch.
- Only this route, because it was 521 of 585 slow lines and its output is a display. Rejected: all 165 safeRoster() callers.
- All captures start together, so they are all equally young. Rejected: a small pool, which ages the first panes past the limit.

## Weakest premise
Two. Snapshot has side effects (the disruption self-heal, limit rows) that now see text up to 3 s old on this route; today's text is
about 0 s old at its classify. And this relieves only this route: safeRoster() callers still hold the thread, so a health miss
can shrink rather than end. Not yet measured on a real stall.

## What would change my mind
A real stall with /api/health still missing with this in place means the other callers matter and need their own step.
