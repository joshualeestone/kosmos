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
Every top-level function that calls `res.writeHead` was listed. `sendFileStream` already destroys the response when
its head is out. `refuseDownload`'s direct 204 branch is reached only from early refusals; its one call inside a
catch (the folder zip's length) runs before any head. No other head writer is called from a catch.

## Test
`server.headers-twice-7686.test.js` makes `fs.createReadStream` throw once, which is after the preview route's head is
written (sendFileStream opens the stream outside its own try). It records unhandled rejections instead of letting
them end the test process.
- Red before the fix: `ERR_HTTP_HEADERS_SENT` escapes the route (and the response hangs, so the request helper has a
  5 s cut-off).
- Green after: no rejection, the response is cut, and the board answers 200 again.
- Controls: the preview answers 200 before the failure, and the injection is asserted to have fired.

## Weakest premise
That the thrower on Josh's board was inside the preview's `.then` after the head. The log records neither the
request nor what threw. The fix does not depend on it: whatever threw, sendJson can no longer throw a second head.
A crash with a different stack would mean another path, and the card says so.
