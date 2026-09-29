# #4562: the status poll gets a time limit, so a frozen board gets the restart screen

## Finished looks like
- A board that is running but frozen (it accepts the connection and never answers) shows the #4343
  restart screen within about STATUS_POLL_TIMEOUT_MS + RESTART_SCREEN_AFTER_MS (plus up to two 5 s polls),
  on the Mac page and the Windows page (shared web code), and clears by itself when the board answers.
- A slow board that answers inside the limit never counts as down: no note, no screen, no failure clock.
- Any HTTP answer, even a refusal, still counts as the board answering (#268 unchanged).

## How
- `tick()` sends `/api/status` with an AbortController signal, aborted after STATUS_POLL_TIMEOUT_MS
  (10 s, the Windows launcher's own "stuck" limit); the abort lands in tick's catch with answered = false.
  The signal also covers the body read. The timer is cleared once the body is read and in the catch.
  Feature-guarded (no AbortController: no limit, as before); the constant is typeof-guarded because
  unit tests lift tick() alone.

## Decided (weakest premise named)
- 10 s, not the page's other 8 s reads: matching the launcher means both halves call a board stuck at the
  same moment. Weakest: that a healthy board never takes 10 s to answer /api/status on a loaded machine.

## Rejected
- AbortSignal.timeout: absent on Safari before 16.

## Verification
- `docs/browser-checks/render-restart-screen-4343.js`: a 'frozen' mode (connection held, never answered)
  and a 'slow' mode (answers 3 s late). Frozen: the screen appears inside the bound and clears on recovery;
  slow: never down. Against origin/main's page the frozen arm fails (no screen after 40 s). 67 checks.
- Unit: web.*.test.js 2160.
