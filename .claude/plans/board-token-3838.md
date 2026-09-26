# board-token-3838 (kosmos#3838, app half)

Josh's first remote visit (2026-09-25 17:13 CDT) drew "This board is not signed in": since #1946 the board refuses /api/ without its token, and the tunnel never presented it.

This half: engine/remote.js startChild passes the board token file's PATH (boardauth.enforcedTokenPath(), since round 1) to kosmos-tunnel run as KOSMOS_BOARD_TOKEN_FILE in its environment. Not argv: the path is harmless but an older bundled tunnel refuses an unknown flag and would never connect; an unknown env var is ignored (then the board stays "not signed in", exactly as today, until the new tunnel ships).

The tunnel half (kosmos-relay board-token-3838) reads that file for each ADMITTED request, strips any visitor-supplied token header/cookie, and presents the real token to the board. Both halves are needed; a Kosmos cut must bundle a kosmos-tunnel built from that relay commit.

Test: remote.test.js "#3838: the tunnel is told where the board token file is, by environment, never argv". Control: without the env entry it fails "the tunnel was not told the board token file".

## Round 1 review (opus) fixes
- WARNING: the board can enforce a token that exists only on the legacy leaf (readToken falls back, the backfill is best-effort), while the tunnel was told the primary path. New boardauth.enforcedTokenPath() returns the file readToken reads from; startChild uses it. Test in engine.boardauth-leaf-2509.test.js (legacy-only, both, neither); control without the legacy arm fails.
- WARNING: the remote.js test compared against tokenPath() itself; it now compares against the literal DATA_ROOT/board.token.
- NIT: the run-env record is cleared at the start of the test; a throw finding the path is logged as what it is, and the tunnel still starts.
- Left (NIT): the cross-repo contract (a Kosmos cut must bundle a kosmos-tunnel that reads KOSMOS_BOARD_TOKEN_FILE) is stated in the PR, not enforced by a test.

## Round 2 review (sonnet)
- WARNING: the remote.js test could not tell enforcedTokenPath() from tokenPath() (both give the primary path in the sandbox). New test replaces enforcedTokenPath with a legacy-only answer and asserts the tunnel gets it; control with remote.js calling tokenPath() fails.
- NITs left: the lazy require inside startChild (kept lazy so a board that never starts the tunnel never loads it; no cycle); no test of a throwing enforcedTokenPath.

## Round 3 review (opus)
- WARNING: enforcedTokenPath re-implements readToken's precedence; every arm of its test now asserts the named file holds exactly readToken()'s value, plus an empty-primary arm (readToken falls back; so must the path).
- WARNING: the no-argv check now refuses any argv element containing board.token, not one flag spelling.
- NIT: a KOSMOS_BOARD_TOKEN_FILE inherited from the launcher is dropped before the tunnel's own is set.

## Round 4 review (sonnet)
- WARNING: the drop of an inherited KOSMOS_BOARD_TOKEN_FILE had no test. New test: a stale inherited value plus a throwing enforcedTokenPath; the tunnel gets none. Control without the delete fails.
- NIT: the "neither" arm also checks agrees().

## Round 5 review (opus)
- WARNING: nothing proved the token VALUE never reaches the tunnel's env/argv (the sandbox has no token file, so a leak would stay green). The fake now records its whole env for `run`; a test writes a known token to DATA_ROOT/board.token and asserts it is in no env value and no argv element. Control: adding the value to the env fails it.
- NIT: the stale-env test restores the variable it overrode instead of deleting it.
- Left (NIT): the other tunnel verbs still inherit a launcher's KOSMOS_BOARD_TOKEN_FILE (none reads it); win32 env-key case; the path is chosen at tunnel start (no rotation exists).

## Round 6 review (sonnet)
- WARNING: the round-5 fake wrote the tunnel child's ENTIRE environment to a temp file that outlived the run (on a shared box it can hold real credentials). The fake now reads a planted probe value from a file and records only the NAMES of env variables containing it; the test deletes probe and record in finally. The two dumps earlier runs left were deleted. Control: a planted leak still fails, by name.
- NIT, left: enforcedTokenPath can throw where readToken returns null; remote.js catches it.

## Round 7 review (opus)
- WARNING: the startChild comment said the token file is mode 600, untrue for a legacy-leaf copy. Now says what holds: it is the same file the board reads its token from, so the tunnel adds no trust the board has not already placed in it.
- NIT: the value-leak test clears the .run-env record before it starts, like its siblings.
- NIT, left: SANDBOX-level fake records (a path and []) are not removed; nothing sensitive.
- Baron's review (relay half, 18:30): the board token reaches a browser only via the bootstrap Set-Cookie, which the tunnel scrubs; tokendoor.js holds service tokens and never answers them. The scrub covers headers only, and that premise is what makes it enough.

## Rebased onto main at 7d412141f (Pete's #3843)
- The branch was re-applied as one commit on current main (its PR is squash-merged anyway); the only conflict was two independent tests added at the same spot in engine/remote.test.js (Pete's #3827 test and this #3838 test), both kept. The old tip is kept locally as board-token-3838-pre-squash.
