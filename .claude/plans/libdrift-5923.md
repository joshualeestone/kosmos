# libdrift-5923: queued-heavy says, and safely fixes, a shared lib checkout behind main

Card: #5923. Owner: April (night shift, 2026-10-12).

## Problem
tools/queued-heavy.sh loads the queue guards from one shared checkout (default ~/work/kosmos-bc-main-4610, #4977).
Nothing kept it at origin/main or said when it was not; on 10-12 it sat 2,058 commits behind.

## Call (Renet's proposal on the card, both halves)
In queued-heavy.sh, before it sources the lib, under a lock (queued-heavy-lib.lock in the marker dir) held until the
lib is loaded:
1. Say it: compare tools/lib/cut-guard.sh and tools/lib/process-fixture.sh (the two files loaded) as they are on
   disk with origin/main's, and print one QUEUED-HEAVY line: match, moved, or DIFFERS and not moved (with why).
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
(no move, said on the line). The run itself and its direct children are excluded by pid and ppid: the subshell of the
ps pipeline keeps this script's argv, so without the ppid exclusion every real run counted itself and never moved
(challenge iteration 1; caught only once a test arm used the real ps).

Residuals, stated:
- A copy of the script older than #5923 takes no lib lock, so one that STARTS during a move is not held off by it.
- Merging changes only the repo copy. The installed copy (~/.cache/claude-handoffs/queued-heavy.sh, what agents run)
  is installed by hand, written beside and moved over; April installs it after merge as part of this card.
- The lock's dead-holder takeover is check-then-act, as _qh_take's is: two joiners reading the same dead pid can
  both end up holding it. A dead holder needs a joiner killed inside its check (about a second).
- Past about 5 minutes on the lock a run loads the lib unchecked rather than wait without bound.
- The ps match is split on spaces: shell options before the path, `env bash`, or a path with a space is not seen.
  A ps that fails or prints nothing blocks the move ("could not list processes").
- A move replaces the whole checkout, so a process whose working directory is inside it blocks the move (lsof -d
  cwd, about 0.3 s). A process using files there without its working directory there is not seen.
- kill -0 on a live holder owned by another user fails (EPERM) and reads as dead; every agent here is one user.
  A lock whose pid was reused by another command is taken over (the holder records its command line).

## Tests
tools/test-queued-heavy-4977.sh, thirteen #5923 arms (EXPECTED 118), listed in the file. Two use the REAL ps under a
private script name (QH_TEST_PS_NAME): the run does not count itself (perturbed by removing the ppid exclusion: that
arm went red), and its control, a live process of that name, blocks the move. The rest use the QH_TEST_PS and
QH_TEST_CWD seams so real processes on the box cannot sway them.
