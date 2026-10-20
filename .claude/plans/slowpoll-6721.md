# slowpoll-6721: one missed poll says Reconnecting; two in a row is the full card; the board logs slow requests (kosmos#6721)

## Goal
Josh saw the full "Your Mac is not answering" card at 08:44:45 and again at 09:01 CDT 10-20 while this Mac's load spiked
(1-minute load 43). Each time the board answered in 0.4 s a moment later. Relay, tunnel and coordinator were all up
(kosmos#6721). Call (Splinter 09:04, Josh can override): (1) the full card only after 2 unanswered polls in a row, a
small "Reconnecting..." in the header after one; (2) the board logs any request slower than 5 s with route and duration.

## Call
- server.js `watchSlowRequest`, attached right after pathOf in the request handler: on the response's finish or close,
  a request over SLOW_REQUEST_MS (5000; KOSMOS_SLOW_REQUEST_MS overrides) writes one line to stdout (board.log):
  `[slow request] <METHOD> <path> took N.N s (answered <status> | the browser gave up before an answer)`. Path only,
  never the query (a query can carry a token, #1946/#2029); control characters in the path cannot add a line; a
  throwing writer never escapes. No route streams or long-polls (grep), so nothing is slow by design.
- web/index.html tick's catch: `BOARD_MISSES` counts unanswered polls in a row. If the board has answered before
  (BOARD_LOOKED) and this device is not offline, the FIRST miss shows #hdr-reconnect ("Reconnecting…", small, muted, in
  the header before the user menu) and returns before any failure paint, so the board keeps what it showed. The
  second in a row falls through to the full failure, as before. A refusal is an answer (resets). A success resets
  and hides it. A board that has never answered, and a device that is offline, are unchanged (immediate).

## Rejected
- Applying it only through Kosmos+: Josh hit it at the computer's own app too (the local board also stalls under
  load), and the rule is right in both places.
- Still repainting the board's failure ("could not refresh", the empty-board box) on the first miss: that is the noise
  Josh sees; keeping the last good board for one poll is the point.
- A longer poll limit instead: it would make a real outage slower to say everywhere.

## Weakest premise
That one 5 s poll gap is enough grace. A board stalled longer than one poll cycle still shows the full card (by
design). The slow log records what the board answered slowly; it cannot see a request that never reached it.

## Tests
- server.slowrequest-6721.test.js 6/6: answered late, gave up, under the limit (control), path cannot add a line,
  throwing writer, default 5 s, and the real board logging a request by path without its query.
- web.offline-note.test.js 24/24: three #6721 tests through the real lifted tick (first miss Reconnecting and no
  note; second in a row the note; an answer restarts the count; CONTROL never-answered board is immediate). Mutant
  (grace removed) reds two.
- Browser checks: render-offline-note (killed board: Reconnecting first, note second, Reconnecting gone), 
  render-phone-offline-718 (waits for two polls) 19/19, render-restart-screen-4343 (bound + one poll cycle) 78/78,
  render-agent-sort-4428 40/40.

## Round 1 (opus): 1 blocker, 4 warnings, 3 nits, all addressed
- BLOCKER: the slow line logged the whole path, and a webhook call carries its secret IN the path (/hooks/<id>/<secret>).
  FIXED: gateLog's redaction is now one function, safeLogUrl, used by both logs; a test sends slow webhook calls in four
  spellings and the secret never reaches the line (CONTROL: a settings route under "webhooks" keeps its path).
- WARNING: nothing tested that an answered poll resets the count. FIXED as a source pin (the success path needs a whole
  status body to run lifted; the pin says so): BOARD_MISSES = 0 and paintReconnecting(false) right after BOARD_LOOKED.
- WARNING: var(--muted) is not defined, so the fallback failed contrast. FIXED: var(--k-ink-2), the page's muted ink.
- WARNING: a revealed live region is often not announced. FIXED: always present, its TEXT changes.
- WARNING: the restart screen now starts one poll later; the comment and the check's bound were off. FIXED: the comment
  says so; the bound adds one 5 s poll gap, not gap plus limit.
- NITs FIXED: "closed before an answer" (the server can close too); the comment admits piped downloads can log as slow;
  no Reconnecting during a restart the person asked for.
