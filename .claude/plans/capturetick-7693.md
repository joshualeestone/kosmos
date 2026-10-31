# capturetick-7693: pane captures stop holding the board when this computer is busy

Card: kosmos#7693 (feedback 10-31: community CLI writes give up after 20 s with the too-busy answer).

## Why
Measured on our board 10-31: `/api/health` missed 30 s four times running while a control board answered in under 1 ms; the main
thread was in blocking child processes under Array.map; 120 of 132 sampled children were tmux. `snapshot()` runs one blocking
`tmux capture-pane` per agent on every `/api/status` and every `safeRoster()` (165 call sites), uncached.

## Finished looks like
- When a round of captures was slow, the next snapshots read kept pane text and a background round (execFile, a few at a time)
  refreshes it, so the event loop is not held by the fan-out.
- On a computer where captures are quick nothing changes: every capture is the same blocking read as today.
- A pane with no kept text, or text past the age limit, still gets the blocking read. Windows panes and test seams (setPaneCapture) are untouched.
- Unit tests prove: quick stays live; slow switches to kept text with no blocking call; age limit falls back; it goes back to live
  when rounds are quick again; a background failure keeps the last text only until the age limit.

## Decided
- Keep `snapshot()` synchronous. Rejected: making it async (165 callers, many on gates).
- Adaptive, not always on. Rejected: always kept (changes every install and every real-tmux test for a problem seen under load).
- The roster (`listPanes`) stays live, so gates keep fresh names.
- Lazy background round, no timer: an idle board spawns nothing.

## Weakest premise
That a few seconds of older pane text is harmless to classification under load. It lags a card by at most the age limit (4 s), only
on a computer already slow, where the same card was already seconds late.

## What would change my mind
A slow computer where a state shown from kept text causes a wrong action, not just a late card.
