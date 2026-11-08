# kosmos#8233: the report hook's turn-end leftovers from #8230

Follow-up to #8230 (PR #8234, merged 949a322430), whose review loop reached its round cap. All four items, in
engine/kosmos-report-hook.js and its turn-end test.

## Calls
1. **A noRetry Stop is noted when lost.** The Windows supervisor's in-process idle (engine/win32codexsup.js) passes
   noRetry, which skipped the whole turn-end block, so a lost idle left no line in turn-end-failures.log. Now an
   agent's Stop with noRetry is still sent once in SHORT_TIMEOUT_MS and never retried, but a lost or busy outcome is
   noted at once (" (not retried: its caller does not wait)"). No board at the address stays unnoted, as for any Stop.
   Rejected: retrying it. The caller does not wait, so a late retry could land after the next turn's working (#8230's
   reason for noRetry).
2. **A body-read abort is unconfirmed, not lost.** In deliver(), our own AbortError from res.text() (the timeout fired
   after the headers) now returns cutOff with the status. The board writes its head and body together once it has
   decided (server.js sendJson), so it did answer and may have recorded. So it is not resent (a second idle) and the
   note says "idle unconfirmed (not retried): the board answered <status> but its answer was cut off". A loud
   SessionStart names the same reason instead of "could not be reached". Any other body failure keeps the old path
   (empty body, an ordinary loss, retried).
   Rejected: classing it busy, as the card first put it. A review measured that the board has always decided by then,
   so "too busy" and "not delivered" would both be false.
3. **Wording.** The file header now says the supervisor's noRetry Stop keeps SHORT_TIMEOUT_MS. The #8230 plan's
   "Two #1765 tests updated" now gives the count measured from the diff: four tests change code (the card said
   three): token-only, fresh nonce, the seam decides, and no production caller.
4. **The late-refusal special case is removed.** #8230 read a retry's proof timeout after a refused first try as
   nothing there, on the premise that Windows refuses a closed local port only after about 2 s. Homer measured it
   refused at once (median 0 ms, max 2 ms). So that case is now a busy board, noted after a retry, as on the Mac. The
   #8230 plan line is corrected and cites the measurement.
   Rejected: keeping it as a guard. It guards a premise measured false and hides exactly what the note exists to show.

## Weakest premise
Item 4 rests on one Windows box. Security software elsewhere could delay a refusal; then a closed board gives one
extra note line, the safe direction.

## Tests
engine/kosmos-report-hook.turnend-8230.test.js:
- noRetry: sent once, short window, a lost and a busy Stop each noted; controls: no board, a landed Stop and the
  person's own session (no agent token) note nothing.
- a busy retry after a refused first try is noted; control: refused twice is not.
- a body-read AbortError is noted unconfirmed and not resent; control: another body failure is retried and noted.
- noRetry also has a keep control (the board's own skip is never noted).
Mutants, each measured red: the noRetry note removed; the body-abort branch removed; the special case restored; a
cut-off answer read as a timeout again.
