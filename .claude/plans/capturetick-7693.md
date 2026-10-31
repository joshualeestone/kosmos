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
- Nothing is kept: gathered text lives only for the one synchronous snapshot built from it (see "After review round 2").
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

## After review round 2
It found that a gather over 3 s re-read every pane blocking, worse than main on exactly the computer this is for. So on this route it
never falls back to that: the gather waits 2.5 s at most; old text is used and marked remembered (#5949, so it can end no report);
at most 3 live reads per snapshot, then no text, marked remembered. The pane list comes from the gather too. A pane mid-restart is
read live so its card cannot go idle off the dead session's screen. Requests sharing a gather each take their own loop turn.

## Weakest premise
1. This relieves only this route: safeRoster() callers still hold the thread, and the unsent-input colour capture is still blocking
   here. A health miss can shrink rather than end. NOT yet measured on a real stall.
2. Young gathered text (under 3 s) is not marked remembered, so on this route a card can lag a Stop report or an answered prompt by
   one poll. Read as display-only: no in-tree caller of /api/status acts on it; external tools and the web page were not traced.
3. execFile's spawn is itself synchronous, and all captures start together; not timed on a busy Mac.

## What would change my mind
A real stall with /api/health still missing with this in place means the other callers matter and need their own step.
