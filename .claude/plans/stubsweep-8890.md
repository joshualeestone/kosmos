# kosmos#8890: a stopped test run stops the processes its tests left in its own run root

## Finished looks like
A run of tools/run-tests.sh that is stopped part way (TERM to its group, as a queue timeout does) leaves no process
running whose command line names its run root (kt<pid>): a test's stub server, started from a script inside the root,
is stopped by the run's EXIT trap before the root is removed, and the run says which pids it stopped. A process under
any other root, including one whose name only begins with this run's (kt<pid>9), is never touched.

## What changed
- tools/lib/test-leak-guard.sh: `leak_names_root`, the one matcher both functions use (exact root path followed by
  "/", "=", a space or the end, in its given and pwd -P forms). `leak_process_stop_root <root>`: every process whose
  command line names the root AND that is this run's own, orphaned (parent 1) or descended from the runner (one awk
  pass over one ps snapshot), never this shell. A live process someone else owns is never touched (review 1). Each pid is read again just before
  its TERM and its KILL: its parent NOW must be launchd or one of this run's, and it must still name the root (reviews
  2 and 3, pid reuse); the grace of about 3 s asks ps only
  about the stopped pids. One line per process (written so a closed pipe cannot end it); silent when there is nothing;
  always returns 0.
- tools/run-tests.sh: the run-root EXIT trap ignores SIGPIPE, INT and TERM first (a second stop no longer cuts the
  clean-up short, review 3; a KILL still ends it), SIGPIPE because (review 2: a Ctrl-C to `run-tests.sh | tee`
  ends tee, and the trap's first printed line would end the trap), and calls it after the launchd boot-out and before
  `rm -rf` of the root.
- tools.run-tests-stubsweep-8890.test.js: three arms. A direct one (review 2): a bash script loads the lib and is
  "this run"; its DESCENDANT and a real ORPHAN under the root are stopped, while orphans under kt<n>9 and another root
  (decided by the matcher alone) and a live process of the test's naming the root (decided by ownership alone)
  survive, and one that ignores TERM is KILLed after the grace (review 3). Then two end-to-end arms. TERM to the runner's group (bash exits through the trap at once):
  the stub is gone and named. Ctrl-C (INT to the group): bash outlives node and the end-of-run leak guard usually ends
  the stub first, so that arm accepts either line and is named as a guard on #4273, not as proof of this card (review 4).
  In both run arms the controls have a live parent outside the run, so ownership protects them; the matcher's
  exactness is proven only by the direct arm (review 4). CONTROLS in both: stubs under kt<pid>9 and an
  unrelated kt root survive, and so does an observer: alive, its parent the outer test, its command line naming this
  run's own root (review 1).

## Calls
- Match by exact root path, never a name pattern (#6698: other agents run on this Mac as the same user).
- Orphans OR the runner's descendants, not anything that names the root: at the trap the stub's parent (the test
  file's node) may still be dying, so orphans alone could miss it; but anything naming the root is NOT this run's by
  construction (another agent's `ls` of it is not), review 1.
- Runs on a normal exit too (the trap runs on every exit); by then the leak guard has reported and stopped orphans, so
  this is usually silent.

## Weakest premise
That every leftover names the run root on its command line, followed by "/", "=", a space or the end (review 4: a
`sh -c 'cd "$ROOT"; node s.js'` shows the root followed by ";" and is not matched). A process started from a path outside the root (or one
that only has the root in its environment, which `ps` cannot read on macOS) is not matched. The six on 11-22 all named
it. Second: a process of ANOTHER agent whose command line happens to contain this run's root path (say an `ls` of it)
in the moment of the trap is now left alone unless it is orphaned (review 1). Third (review 3): run roots are kt<pid>
under a TMPDIR every agent shares, so if an earlier, dead run had this run's pid, its orphans under the same path are
swept too. They are that dead run's leaks either way.

## Evidence
- tools.run-tests-stubsweep-8890.test.js: 3 of 3 (the direct arm in about 6 s, most of it the grace, the TERM arm in 0.5 s; a shell-loop descendant walk took 83 s on
  this Mac, so it is one awk pass).
- Mutations, each red: the trap call removed (the TERM arm: the stub survives); on the direct arm, the descendant walk
  removed (the descendant survives), the match loosened to a bare prefix (the kt<n>9 orphan is stopped), the ownership
  rule removed (the observer is stopped), the KILL removed (the TERM-ignoring stub survives). Review 2 caught that before the direct arm, the prefix mutation could not
  fail (the controls were not orphans, so ownership hid the matcher); and a killed child of the test reads alive as a
  zombie, so liveness reads ps state.
