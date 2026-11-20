# bootpath-board: the sign-in redirect always stays on the board's own path

## Finished looks like
The address the board answers a sign-in with (boardauth.bootstrap's location, built by pathWithoutParam, sent by server.js as the 302's Location) is always a single-leading-slash path on this board, whatever the request's path normalises to; ordinary paths are unchanged.

## Built
- engine/boardauth.js pathWithoutParam: a leading run of slashes or backslashes in the normalised pathname is collapsed to one slash.
- engine.boardauth-bootpath.test.js: a path normalising to two leading slashes (with ?boot= and ?token=), a backslash, bootstrap's own answer, and controls (the input really normalises that way; ordinary paths unchanged). Removing the collapse fails 3 tests.

## Weakest premise
That pathWithoutParam is the only builder of that address. server.js 7751 sends boot.location from bootstrap, which uses it for both ?boot= and ?token=.

## Review
- Round 1: no blocker. Fixed: the path is '/' plus the pathname with every leading slash or backslash removed, so even an absolute URL of another scheme (no leading slash once parsed) answers a path on this board, without relying on Node's request parser refusing it; an empty path answers '/'. Tests: those inputs, and bootstrap end to end with a real ?boot= nonce. The backslash row (always green: URL parsing already turns it into a slash) is replaced by them. Round 0's version fails the new test.
- Round 2 (converged): no blocker, 29 inputs checked, none leaves the board. Fixed in the test only: a backslash row that can fail (a non-http scheme keeps a leading backslash; a slashes-only rule fails it), and the check resolves the answer against the board's address and requires the same protocol and host.
