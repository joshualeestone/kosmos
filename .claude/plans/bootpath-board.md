# bootpath-board: the sign-in redirect always stays on the board's own path

## Finished looks like
The address the board answers a sign-in with (boardauth.bootstrap's location, built by pathWithoutParam, sent by server.js as the 302's Location) is always a single-leading-slash path on this board, whatever the request's path normalises to; ordinary paths are unchanged.

## Built
- engine/boardauth.js pathWithoutParam: a leading run of slashes or backslashes in the normalised pathname is collapsed to one slash.
- engine.boardauth-bootpath.test.js: a path normalising to two leading slashes (with ?boot= and ?token=), a backslash, bootstrap's own answer, and controls (the input really normalises that way; ordinary paths unchanged). Removing the collapse fails 3 tests.

## Weakest premise
That pathWithoutParam is the only builder of that address. server.js 7751 sends boot.location from bootstrap, which uses it for both ?boot= and ?token=.
