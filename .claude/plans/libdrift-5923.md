# libdrift-5923: queued-heavy says, and safely fixes, a shared lib checkout behind main

Card: #5923. Owner: April (night shift, 2026-10-12).

## Problem
tools/queued-heavy.sh loads the queue guards from one shared checkout (default ~/work/kosmos-bc-main-4610, #4977).
Nothing kept it at origin/main or said when it was not; on 10-12 it sat 2,058 commits behind.

## Call (Renet's proposal on the card, both halves)
In queued-heavy.sh, before it sources the lib, under a lock (queued-heavy-lib.lock in the marker dir) held until the
lib is loaded:
1. Say it: compare the blobs of tools/lib/cut-guard.sh and tools/lib/process-fixture.sh (the two files loaded) at
   HEAD with origin/main's, and print one QUEUED-HEAVY line: match, moved, or BEHIND and not moved (with why).
2. Move it only when safe: the DEFAULT checkout only (QUEUED_HEAVY_LIB unset, no #5446 fallback), detached, clean,
   no queue marker (suitewait.*, machine-claim, light-side-claim), and no other queued-heavy.sh process. Then
   `git checkout --detach origin/main`. Otherwise join on the lib as it is (one generation per queue, #4977).

origin/main is read from the checkout's own refs (on Agent1s it is a worktree of ~/work/kosmos, which every agent
fetches). Nothing is fetched by the script.

## Rejected
- Refusing past a threshold: blocks work over a stale lib that may be identical in the files that matter.
- Commit distance as the measure: 2,058 commits behind with both files unchanged (Renet's correction).
- A launchd job, or the main canary moving it: a second moving part that cannot see the queue.

## Weakest premise
A waiter is recognised in ps only as `<shell> <path>/queued-heavy.sh ...` or a direct exec of it. A queued-heavy.sh
started some other way is not seen as live, and a move could then mix generations. Stale markers err the other way
(no move, said on the line).

## Tests
tools/test-queued-heavy-4977.sh: seven #5923 arms (moved; then matches; marker blocks; live waiter blocks; CONTROL:
caller shell and grep are not waiters, move happens; QUEUED_HEAVY_LIB set is report-only; local changes block and are
kept). QH_TEST_PS seam replaces ps so real waiters on the box cannot sway the arms.
