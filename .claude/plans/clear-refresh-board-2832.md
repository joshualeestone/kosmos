# clear-refresh-board-2832 -- Clear button also refreshes the board "Needs you"

Card: kosmos#2832 (Josh, live 0.6.57 review 2026-09-11). Follow-up to #2808 (the agent-page "Clear this message" dismiss button I shipped in PR #2817).

## Josh's ask (verbatim)
> i love that we have a "clear this message" but when i hit the button can you clear it as well as refresh the screen so it takes off the "Needs you" prompt from the agents status line

## The gap
The #2808 clear handler POSTs `/api/agent/<name>/clear-selfreport`, then on success calls `paintTalk(CURRENT.sessionName, CURRENT.name)` -- which re-reads THIS agent's thread and takes the `#d-qask` question box off screen. But the BOARD roster / "Needs you" counts (`st-attn` / `st-pjattn`, the agent's status line) are painted by `tick()` (the `/api/status` poll, ~5s), NOT by paintTalk. So after a clear, the "Needs you" indicator lingers on the status line until the next poll.

## Fix
In the clear handler's success branch, after `paintTalk(...)`, add `await tick()`. `tick()` re-fetches `/api/status`, sets `LAST`, and repaints the board (roster + "Needs you"), so the indicator comes off immediately. This is the exact `await tick()` pattern every other post-action refresh in web/index.html uses (25128/25171/25187/25766/25994/26004 -- e.g. after remove/restart actions). One line, inside the existing capture-and-recheck guard, so it only fires for the agent still open.

## What finished looks like
- Clicking "Clear this message" clears the message box AND the "Needs you" comes off the agent's status line without waiting for the next poll.
- The clear still no-ops correctly on failure / mid-POST agent switch (unchanged).
- Node test asserts tick() is invoked on a successful clear; full suite green; challenge-loop converged.

## Verification
- Node runtime slice of the clear handler (extends web.qask-clear-clamp-2808.test.js): on success it POSTs clear, re-reads via paintTalk, AND calls tick(); on failure it does neither. No Playwright this session -- the board-refresh visual is Josh's in-app pass; the tick() call is pinned by the runtime slice.
