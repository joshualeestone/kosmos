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
   its commit an ancestor of origin/main (a checkout ahead or diverged is never moved back), origin/main's
   cut-guard.sh still defining every function this copy calls (the side lane's too, when it offers side turns; else
   every later join would exit 3), no queue marker (suitewait.*, machine-claim, light-side-claim), and no other queued-heavy.sh process. Then
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
- A copy of the script older than #5923 takes no lib lock, so one that STARTS during a move is not held off by it,
  and the QH_NEED_BASE check covers only this copy and the installed one: an older copy run from another worktree
  that calls a function a move dropped would exit 3 (iteration 18).
- The files compared are a hand-kept list (cut-guard.sh and what it sources, process-fixture.sh); a third sourced
  file would read as "match" until added (iteration 18, noted at `files=`).
- git is held inside the lib folder (GIT_CEILING_DIRECTORIES, and no check at all without its own .git), so a lib that
  lost its .git is never read, or moved, as an enclosing repo (iteration 18; arm "nogit").
- Merging changes only the repo copy. The installed copy (~/.cache/claude-handoffs/queued-heavy.sh, what agents run)
  is installed by hand, written beside and moved over; April installs it after merge as part of this card.
- The lock's dead-holder takeover is check-then-act, as _qh_take's is: two joiners reading the same dead pid can
  both end up holding it (the pid is read again just before the takeover, which narrows the window but does not close
  it). A dead holder needs a joiner killed inside its check (about a second).
- The checkout runs in its own process group, so a terminal Ctrl-C does not reach git; bash ignores INT, TERM and
  HUP while waiting. git installs its own signal handlers, so a signal sent to git directly does stop it part way
  (measured by challenge iteration 11: 3,000 files left mixed). Measured 2026-10-12 10:2x, both arms twice, a 3,000-file checkout with INT sent to the
  script's process group 0.12 s in: grouped, rc 0 at the target and clean; plain, rc 128 with 3,000 files mixed. On any failed checkout the old commit is checked out
  again by force and the line says so; if even that fails, the line says FAILED PART WAY with the repair command. A
  KILL (or ALRM) of the wrapper during the checkout does not stop git, which runs in its own group and usually
  finishes; its pid is written to the lock (gitpid), and a joiner does not take the lock over while that git lives, so
  no run loads a half-written lib (iteration 19, arm "gitlive"). A joiner also waits while the lib's index.lock exists
  (iteration 21, arm "idxlock"; both arms check the lock while the joiner is IN its lock loop, iteration 22). The gitpid is removed once git exits, and a live gitpid
  running another command than the one recorded beside it (gitcmd) is a reused pid and does not hold the lock
  (iteration 23, arm "gitreuse"): that covers the instant before the pid is written. An index.lock
  left by a git that was itself killed holds joiners until the 5-minute give-up (it blocks every git there anyway). If git is itself killed part way, the tree is left
  mixed and is not repaired automatically. The checkout back runs the same way (own group, INT/TERM/HUP ignored
  until it ends). The checkout back is
  forced, so a tracked edit made inside the checkout between the clean check and a failed move is discarded (the
  lock and the working-directory gate make such an edit unlikely). If the checkout back fails too but HEAD is still
  the old commit and no tracked file differs from it, the line says the checkout is unchanged rather than MIXED.
  git runs off the terminal (stdin and stdout /dev/null), so it cannot be stopped by job control and hang the wait.
  A TERM, INT or HUP sent to the wrapper during the move (about a second) is DROPPED, not deferred: the wrapper then
  joins the queue and runs the command anyway. Accepted for that window (iteration 22); a caller that must stop a
  run sends the signal again, as any queue waiter's caller already has to after the move.
- A move needs an idle queue: any other live queued-heavy.sh blocks it (a queue waiter, and also a run spinning on
  the lib lock, so two joins that overlap move nothing), and any suitewait.* marker blocks it, and run-tests.sh suites write those too (they load
  the lib from their own worktree, not this checkout). On a busy box the move may seldom fire; it never fails
  silently, since every join prints DIFFERS and why. If it stays behind in practice, a follow-up can count only
  markers written by queued-heavy.sh runs.
- The QH_TEST_* seams are ignored when HOME is the user's real home, so a leaked export cannot reach the shared
  checkout. No arm covers that branch: exercising it means running against the real home and the real checkout.
- The #5446 fallback is skipped when the default folder is a git checkout, so a run reading during a move cannot fall
  back to another lib; a default checkout that really lacks cut-guard.sh exits 3 instead of falling back, and its
  message says the fallback is off for it and how to bring it up to date. A holder
  KILLed during `git checkout` leaves a half-moved tree. The next joiner reads it as local changes, does
  not move it, says so on its line, and loads it as it is. Nothing repairs it automatically; the moved line printed
  the command that puts it back.
- Past about 5 minutes on the lock a run loads the lib unchecked rather than wait without bound, and says it may be
  in the middle of a move. A checkout takes about a second, so a holder that long is hung; git and lsof have no
  timeout of their own. The checkout runs with hooks off. An unwritable marker dir skips the check and says so.
- The ps match is split on spaces: a path with a space is not seen, nor, for the instant before the #5467 re-exec,
  shell options before the path or `env bash`.
  A ps that fails or prints nothing blocks the move ("could not list processes").
- Readers of the lib that are not queued-heavy.sh: in this repo only heavy-gate.sh looks at the shared checkout, and
  it only tests that cut-guard.sh exists (to choose a hint), so during a move it can briefly name the other copy. A
  script outside this repo that sources it without holding a marker or working inside the checkout is not seen.
- A move replaces the whole checkout, so a process whose working directory is inside it blocks the move (lsof -d
  cwd, about 0.3 s, run while the lib lock is held and only after every cheaper gate has passed). A process using files
  there without its working directory there is not seen, and as a non-root user lsof sees only this user's processes;
  every agent here is one user.
- kill -0 on a live holder owned by another user fails (EPERM) and reads as dead; every agent here is one user.
  A lock whose pid was reused by another command is taken over (the holder records its command line).

## Tests
tools/test-queued-heavy-4977.sh, thirty-seven #5923 arms (EXPECTED 142), listed in the file. Two use the REAL ps under a
private script name (QH_TEST_PS_NAME): the run does not count itself (perturbed by removing the ppid exclusion: that
arm went red), and its control, a live process of that name, blocks the move. The rest use the QH_TEST_PS and
QH_TEST_CWD seams so real processes on the box cannot sway them.

- The installed copy (~/.cache/claude-handoffs/queued-heavy.sh, what agents run) is checked too: a move needs
  origin/main's lib to define every function in the installed copy's QH_NEED_BASE, and an installed copy with no such
  line (older than #5923) blocks every move until this copy is installed. So the drift is only fixed after install.
- Not tested: the 5-minute give-up of the lock, and the not-default refusal through the #5446 fallback (only through
  QUEUED_HEAVY_LIB). Unchanged from earlier rounds.
