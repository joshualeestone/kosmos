# headers-7686: a failure after the head never writes a second head (kosmos#7686)

## Why
On 10-31 at 11:51 CDT Josh's board crashed and restarted, and with it every connection: the iPhone and the remote
link went too ("My Kosmos app isn't connecting", 11:55). board.log has `ERR_HTTP_HEADERS_SENT` at `sendJson`, called
from the attachment preview route's `.catch(() => sendJson(res, 404, ...))`. The `.then` had already written the
head (`sendFileStream`), something threw after it, the catch wrote a second head, `writeHead` threw inside the
catch, the rejection went unhandled, and the board has no process-level handler, so it ended.

## The call
Fix it at the chokepoint, not per route. About 200 routes answer a failure with `sendJson` from a catch (counted on
main 9cf6c3d426: 200 lines with `.catch(() => sendJson(`, `.catch((e) => sendJson(` or `.catch((err) => sendJson(`), and about a dozen already guard it by hand with
`if (!res.headersSent)`. So `sendJson` itself checks `res.headersSent`: it logs one line, destroys the response
unless it has already ended, and returns. The client sees a cut, never a 200 head with a 404 body.

Rejected: guarding each catch by hand (200 sites, and the next new route reopens the hole); a process-level
`unhandledRejection` handler (it would hide every other defect of this kind, and the board's comments record a
deliberate choice not to have one).

## Sweep of the other head writers
Every `res.writeHead(` in server.js was read in context (40 on main; 39 on this branch, which moves the two `as=text` heads into one `sendText`), not only the top-level functions
(review 2: the first sweep listed functions and missed inline closures).
- Guarded now, because a head can already be out when they run:
  - `sendJson` and `refuseDownload`, both through `answeredAlready`;
  - the `as=text` `fail` closures in `/api/inbox` and `/api/report`. Inbox writes its 200 head before formatting the
    rows, so a throw there reaches the route's catch; report builds its text first, so there it is defence only. Both
    now answer through `sendText`, which shares the guard, and a source test pins that wiring.
- `sendFileStream` and `sendFileDownload` close the descriptor and end the response if opening the stream throws
  after the head (review 5 found the second; in an fs callback that throw is an uncaught exception, so the board died
  there too).
- A cancelled download (review 6): when the client leaves while `sendFileDownload` opens and checks the file, its fs
  callback met a destroyed response, and `pipeline` throws at once on one (measured, Node 26), uncaught in that
  callback. It now closes the descriptor and returns before any head; its `pipeline` is also wrapped. The two cover
  each other, so the test goes red only with both removed.
- `sendFileStream`'s `pipeline` is wrapped the same way, as a DEFENSIVE guard no test pins: on the preview path its
  `'data'` listener makes the stream flow and close its own descriptor, and the throw reaches the route's catch, so
  the guard changes nothing observable there (mutation measured: green). It matters for a synchronous caller (the
  attachment download route), where the throw would be unhandled; a synchronous route cannot be delayed
  deterministically in a test, so it is stated here rather than claimed tested.
- `sendJson` serialises before its head (review 4). That is also what keeps the `try { sendJson(200, x) } catch {
  ... 500 }` pattern working, the agents route's own catch-500 included: do not move the serialise back after the
  head.
- The rest write the FIRST head on their path (a redirect, a 204 check answer, a static file, a page), with nothing
  that can have answered before them.
- Rejected: wrapping `res.writeHead` for every response. It would cover all 40, but the caller then calls `res.end`
  on a destroyed response. That was measured silent on Node 26 here, but the board ships its own runtime, and a
  guard that rests on one runtime's behaviour is the wrong kind of guard.

## Test
`server.headers-twice-7686.test.js`, twelve tests. Unhandled rejections and uncaught exceptions (an fs callback's throw is the second) are recorded (each test reads only
its own) rather than left to end the test process.
- **The 10-31 crash path, end to end:** a throw after the preview's head, from outside sendFileStream's own catch,
  reaches the route's `.catch(() => sendJson(...))`. Asserted: the guard's log line, no rejection, a cut response, and
  the board answering 200 after. Without the sendJson guard, `ERR_HTTP_HEADERS_SENT` escapes the route.
- A preview whose stream cannot open after its head: the descriptor is closed (counted on the file) and the response
  is cut.
- The diagnostics download failing after its head, with the injection only when sendDiagnostics is the caller:
  `refuseDownload`'s guard, end to end.
- A project download whose stream cannot open after its head: no exception escapes, the descriptor is closed, and the
  response is cut.
- Unit tests: sendJson, sendText and refuseDownload after a head end the response and never throw (sendJson's also
  checks the log names the route with no query); a response that already ENDED is not destroyed; a value sendJson
  cannot serialise throws before any head.
- A source test: every `as=text` `fail` closure answers through sendText and writes no head of its own.
- A download the client cancels while the file is opened (fstat held until the client has gone): nothing escapes, no
  descriptor stays open, and the board answers after. And a preview cancelled while it is drawn: the same.
- A file-level check that nothing escaped anywhere in the file, including outside any one test's window.
- Controls: each injection is asserted to have fired, and the preview answers 200 before each failure.
- Each guard (answeredAlready, refuseDownload's use of it, sendText's, sendFileStream's open catch) turns its own test
  red under mutation.

## Not in this card (found in review round 3)
The records `as=text` route writes its 200 head, then renders with no try, so a throw in the render is an unhandled
rejection with no second head involved. It is a different shape (a throw after a head with no catch at all), so it
has its own card: kosmos#7689. This PR's claim is narrower: no answer can write a SECOND head and end the board.

Also left for kosmos#7689's "after a head" sweep (review round 8, the last one):
- `sendDiagnostics` still writes its head before it serialises. A serialise failure is now a cut, not a crash, but
  serialising first (as `sendJson` now does) would let it answer DIAG_FAILED, so the page's look and the download
  never disagree. Not done here: it came after the last review round, and it would remove the only end-to-end test of
  `refuseDownload`'s late-head guard, which would then need another route to pin it.
- The `as=text` inbox route renders its rows after its 200 head. A throw there reaches the route's catch, then `fail`,
  then `sendText`, which ends the response (traced in review 8). That wiring is pinned by the source test, not by a
  behavioural test of the inbox route itself.

## Weakest premise
That the thrower on Josh's board was inside the preview's `.then` after the head. The log records neither the
request nor what threw. The fix does not depend on it: whatever threw, sendJson can no longer throw a second head.
A crash with a different stack would mean another path, and the card says so.
