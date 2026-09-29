# #4562: the status poll gets a time limit, so a frozen board gets the restart screen

## Finished looks like
- A board that is running but frozen (it accepts the connection and never answers) shows the #4343
  restart screen within about STATUS_POLL_TIMEOUT_MS + RESTART_SCREEN_AFTER_MS (plus up to two 5 s polls),
  on the Mac page and the Windows page (shared web code), and clears by itself when the board answers.
- A slow board that answers inside the limit never counts as down: no note, no screen, no failure clock.
- Any HTTP answer, even a refusal, still counts as the board answering (#268 unchanged).

## How
- `tick()` sends `/api/status` with an AbortController signal, aborted after STATUS_POLL_TIMEOUT_MS
  (10 s, the Windows launcher's own "stuck" limit, per #4543); the abort lands in tick's catch with
  answered = false. The signal also covers the body read. The timer is cleared once the body is read and
  in the catch. Feature-guarded (no AbortController: no limit, as before); the constant is typeof-guarded
  because unit tests lift tick() alone.
- Polls now overlap (every 5 s, each allowed 10 s), so they are numbered on the function (`tick.seq`,
  `tick.answeredSeq`): a failure paints only if no newer poll has answered (a refusal counts as an answer).
- A poll ended by the limit, with nothing answered, says "nothing answered for 10 seconds" in the board's
  failure box, not the browser's abort text; a refusal whose body stalls keeps its own words (status 500).
- The waits that stand the restart screen down (Restart Kosmos, the update overlay, a world switch) use
  `statusFetchWithin` (the same limit), so a board that comes back frozen no longer hangs them past their
  deadlines. typeof-guarded for tests that lift those functions alone.

## Decided (weakest premise named)
- 10 s, not the page's other 8 s reads: matching the launcher means both halves call a board stuck at the
  same moment. Weakest: that a healthy board never takes 10 s to answer /api/status on a loaded machine.

## Rejected
- AbortSignal.timeout: absent on Safari before 16.

## Verification
- `docs/browser-checks/render-restart-screen-4343.js` gains four modes, each shown to fail without its fix:
  'frozen' (connection held, never answered: the screen inside the bound, the board's sentence, clears on
  recovery; against origin/main no screen after 40 s), 'slow' (answers 6 s late: never down), 'onestuck'
  (one poll held past the limit while the rest answer: no note, no clock), 'refusestall' (500 headers, body
  stalls: keeps "status 500"). 72 checks.
- Unit: web.*.test.js 2160.
