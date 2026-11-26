# nodeorphan-9159: a TERM to run-tests.sh stops its own node --test tree (kosmos#9159)

Owner: Renet Tilley. Reported by PigeonPete (11-26 14:43 and 14:44): after a TERM, node test runners outlived
run-tests.sh, reparented to 1, still starting test files. The file itself said so since #6668.

## Steps
- [x] rt_stop_own_node in both EXIT traps (after TERMing the file watchdog): from one ps snapshot, this bash's direct
      children running `node --test` or `node .../shell-shard.js run`, plus all their descendants; TERM, name each on
      stderr (program and last word), about 3 s, then KILL only pids whose command line is unchanged.
- [x] tools.run-tests-term-9159.test.js: a TERM to the real runner's pid alone stops node, the file and the file's
      own child; a file that ignores TERM is KILLed and named. Both red against main's runner.
- [x] KOSMOS_RT_STOP_OWN_NODE=0, a test seam: the #6668 watchdog-stop arm and the #8890 file use it so they test
      their own mechanisms (the #6668 arm was hollowed out otherwise, measured).
- [x] 6 blind review rounds; rounds 5 and 6 found no BLOCKER or MAJOR.
- [x] Full validation through queued-heavy: PASSED on 1e8a47e9c6.
- [ ] PR; merge after the 0.8.26 holds lift.

## Decisions
- No process-group kill: run-tests.sh shares its group with its caller (queued-heavy, CI).
- Not covered, stated in code: the shell shard under the GitHub cut-shape subshell (a grandchild there); a node path
  containing a space (the root match is anchored, so a `node --test` inside a `bash -c` string never matches).
- Weakest premise: that a TERMed `node --test` stops its running file (measured on node 26.8.1); the KILL after the
  grace covers a file that ignores TERM.
