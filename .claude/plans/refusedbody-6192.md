# refusedbody-6192: a refused read's body is always read, so the request finishes (#6192)

## Problem
Found while fixing #6188: when the board refuses a request and the page never reads the reply's body, the request
did not finish. With every GET under /api/ refused at load, 19 requests were still open (20 s later on the card;
8 s later here, in Chromium). Anything that
waits for the page's network to go quiet then hangs (#6188's check did).

## Change
web/index.html, at the top of the page's main script (before any fetch): window.fetch is wrapped once. On a non-ok
answer it drains a CLONE of the response, not awaited, so the caller can still read the original (a refusal's own
words) and a slow body holds nothing up. A stub fetch whose answer has no clone() is left alone. One place for all of
the page's 376 fetch calls, as the card suggests, rather than 19 hand edits; #6188's two hand edits (streakidle-6188,
not yet on main) keep working beside it.

## Check
docs/browser-checks/render-refusedbody-6192.js on the shared $B8 board (no new boot): every GET under /api/ is sent
on to that board at a path it does not have, so each gets the board's own 404 over the real network (answered at the
browser it would finish at once and show nothing). QUIET: nothing open 8 s after load. CONTROL: a fetch made with
the original fetch (saved by an init script before the page runs), body unread, is still open 4 s later.
Measured both ways on a sandboxed in-process board: main's page fails QUIET with the card's list, this branch passes;
CONTROL passes on both. A tiny stand-in server answering 404 did NOT reproduce it (control 0 open), which is why the
check uses a real board.
Wired: tools/browser-checks.sh run_one (B8 group), docs/browser-checks/b8-board.txt, README row, page scope line.

## Weakest premise
That draining a clone finishes the original request. Measured for the board's own 404s in Chromium (the check). Not
measured: WebKit, and whether any page fetch reads a refusal as a stream it expects to own alone (none found: no
getReader or bodyUsed in the page; a clone tees the body, the original stays readable). Cost: a refused body is
buffered once more, and a refusal that streamed without end would be buffered whole; the board's refusals are small
JSON.

## CI
The scope line puts the check in the PR CI job for any web/index.html change, on a Linux runner, where neither arm
was measured before this PR (review 3). This PR's own CI is that measurement: it changes web/index.html, so the
check runs there before merge, and a red CONTROL blocks the merge rather than reaching main.

## Not changed
community/ready was the one request open without refusals; the card says it may be held by design. Left alone.
