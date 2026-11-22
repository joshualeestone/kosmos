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
  pass over one ps snapshot), never this shell. A live process someone else owns is never touched (review 1). TERM, a grace of up to 3 s that ends early once they are gone,
  then KILL only a pid that is still one we stopped AND still names the root. One line per process; silent when there
  is nothing; always returns 0.
- tools/run-tests.sh: the run-root EXIT trap calls it after the launchd boot-out and before `rm -rf` of the root.
- tools.run-tests-stubsweep-8890.test.js: two arms. TERM to the runner's group (bash exits through the trap at once):
  the stub is gone and named. Ctrl-C (INT to the group): bash outlives node and the end-of-run leak guard usually ends
  the stub first, so that arm accepts either line and guards the pair. CONTROLS in both: stubs under kt<pid>9 and an
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
That every leftover names the run root on its command line. A process started from a path outside the root (or one
that only has the root in its environment, which `ps` cannot read on macOS) is not matched. The six on 11-22 all named
it. Second: a process of ANOTHER agent whose command line happens to contain this run's root path (say an `ls` of it)
in the moment of the trap is now left alone unless it is orphaned (review 1).

## Evidence
- tools.run-tests-stubsweep-8890.test.js: 2 of 2 (the TERM arm in 1.4 s; a shell-loop descendant walk took 83 s on
  this Mac, so it is one awk pass).
- Mutations, each red: the trap call removed (the TERM arm: the stub survives); the match loosened to a bare prefix
  (the kt<pid>9 CONTROL is stopped); the own-process rule removed (the observer CONTROL is stopped).
