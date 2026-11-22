# kosmos#8890: a stopped test run stops the processes its tests left in its own run root

## Finished looks like
A run of tools/run-tests.sh that is stopped part way (TERM to its group, as a queue timeout does) leaves no process
running whose command line names its run root (kt<pid>): a test's stub server, started from a script inside the root,
is stopped by the run's EXIT trap before the root is removed, and the run says which pids it stopped. A process under
any other root, including one whose name only begins with this run's (kt<pid>9), is never touched.

## What changed
- tools/lib/test-leak-guard.sh: `leak_process_stop_root <root>`. Every process (orphaned or not) whose command line
  names the root by its exact path followed by "/", "=", a space or the end (the same forms leak_process_check
  matches, and its pwd -P form), never this shell. TERM, a grace of up to 3 s that ends early once they are gone,
  then KILL only a pid that is still one we stopped AND still names the root. One line per process; silent when there
  is nothing; always returns 0.
- tools/run-tests.sh: the run-root EXIT trap calls it after the launchd boot-out and before `rm -rf` of the root.
- tools.run-tests-stubsweep-8890.test.js: two arms. TERM to the runner's group (bash exits through the trap at once):
  the stub is gone and named. Ctrl-C (INT to the group): bash outlives node and the end-of-run leak guard usually ends
  the stub first, so that arm accepts either line and guards the pair. CONTROLS in both: stubs under kt<pid>9 and an
  unrelated kt root survive.

## Calls
- Match by exact root path, never a name pattern (#6698: other agents run on this Mac as the same user).
- Not only orphans: at the trap the stub's parent (the test file's node) may still be dying, and everything that names
  this run's root is this run's by construction.
- Runs on a normal exit too (the trap runs on every exit); by then the leak guard has reported and stopped orphans, so
  this is usually silent.

## Weakest premise
That every leftover names the run root on its command line. A process started from a path outside the root (or one
that only has the root in its environment, which `ps` cannot read on macOS) is not matched. The six on 11-22 all named
it. Second: a process of ANOTHER agent whose command line happens to contain this run's root path (say an `ls` of it)
in the moment of the trap would be stopped; the root is a fresh temp path named for this run's pid, so that needs
someone to be looking inside this run's temp folder at that second.

## Evidence
- tools.run-tests-stubsweep-8890.test.js: 2 of 2.
- Mutations, each red: the trap call removed (the TERM arm: the stub survives); the match loosened to a bare prefix
  (the kt<pid>9 CONTROL is stopped).
