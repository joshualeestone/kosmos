# runcaps-6616: the board trusts what the RUNNING tunnel can do (R01b part 6, board half)

Card: kosmos#6616 (security hardening R01b). Narrows the residual in `.claude/plans/remotestepup-6595.md` ("the answer
is the BINARY's, not the running tunnel process's"): it closes a binary replaced while THIS board's tunnel runs; a
tunnel orphaned by an EARLIER board stays open (below). Relay half: kosmos-relay branch runcaps-6616 (the tunnel writes
`capabilities` into its status file, stacked on sessioniat-6595).

## What changes
- `engine/remote.js` `connectorCapabilities()` = the binary's answer (unchanged, now `binaryCapabilities`) INTERSECTED
  with the running tunnel's own list, while a tunnel this board started is running. The running list is read from the
  status file only when its `pid` is that child's and `capabilities` is an array; anything else (another pid, not yet
  written, unreadable, truncated, no field) lists nothing. Once this board has started a tunnel, a moment with no child
  running (crash backoff, a stop) lists nothing too (review 1): nothing legitimate arrives then. Before this board has
  started any, `tunnelStartedHere` already refuses everything, as on main.
- So this only ever NARROWS what main trusts. It never widens it: a status file cannot vouch for a binary that says no.
- Test seam: `resetConnectorCapabilitiesForTests({ runningPid })` stands in for a running child without spawning one.

## Rejected
- Replacing the binary ask with the status file outright. Cleaner, but it rewrites a mechanism that went through 19
  review rounds (#6595) and its eleven tests; the intersection closes the residual with no change to that mechanism.
- Falling back to the binary when the running process wrote no field. That is exactly the hole (an older process).

## Tests
`server.remotestepup-6595.test.js`, two `R01b:` tests: listed by the running pid passes (control); no field, another
pid, a non-array, and no file are refused; a status file cannot widen a binary that says no; over HTTP an older running
tunnel gets `remote_step_up_unavailable` and the listed one reaches the route (400 on an unreadable body). Mutants:
ignoring the running list (both red), dropping the pid check (one red). R01c: no per-pid keep, no kill, the prefix
match, and not judging a foreign pid on read, each one red; then (review 4) the parent-is-1 rule, the pid range, the
program check and asking again after a failed ps, each one red. One test reads the real process table with real
orphans (double-forked), a live board's tunnel, a lookalike path and another program. Review 5: the re-ask after a
minute and the for-good record, each mutant red (Date.now moved). Not tested: status() noting the child's write, and the read at tunnel start. Review 6: the matching rules are unit-
tested with no process table (every platform); the real-ps test skips where orphans are not re-parented to 1; a
stand-in kill, so no made-up pid is ever signalled; asking again after TERM, mutant red.

## The orphan, closed here too (kosmos#6669, R01c; review 3)
A tunnel orphaned by an EARLIER board (killed hard, so it could not reap it) still forwards: on the relay's "replaced by
a newer connection" its reconnect loop simply dials again and takes the connection back, so the two alternate. It
writes this board's status file under its own pid, so neither check described it, and (review 3) one such write
refused every gated remote action until this board's tunnel next changed state.
- A pid's list is kept once read (`runningSeen`): a process's capabilities are compiled in, so a foreign write cannot
  take this board's child's answer away.
- A foreign pid in the status file (read at tunnel start, by status(), and by the capability read) is judged: it gets
  SIGTERM only when `/bin/ps` (never PATH) shows its parent is 1 (re-parented, its board gone; review 4: a second LIVE
  board on the same account shares this file, and ending its child would start a kill loop), its program is BIN()
  itself or one token with the tunnel's basename (review 9: no wrapper or editor line), its first argument `run`, and its `--status-file` is this board's path, the whole argument (a prefix
  match ended a tunnel for `<file>.elsewhere` in the tests). A pid outside 2..2^22 is never looked at (0 and -1 signal a
  group); our pid and child are excluded again right before the signal. A definite ps answer is kept per pid; a failed
  one is asked again after 15 s (review 9: a host with no working ps forked one per read). Not closed: a pid that
  exits and is reused between ps and the signal.
- While the status file names a foreign pid not yet settled as one to leave alone (a live board's, not ours, gone,
  Windows), gated remote actions are refused (review 10: ending is asynchronous and both tunnels forward to the same
  port, so a request in that window may be the orphan's). After an orphan is ended this lasts until its pid is asked
  again (a minute) and found gone, unless this board's child writes the file first.
- An install path containing ` run ` makes the program unreadable, so such an orphan is never ended (fails safe).
- Review 11 (no WARNING; converged): a board that is itself pid 1 judges nothing, so a foreign writer there refuses gated
  actions until its child writes (fails closed). A separately supervised tunnel (launchd KeepAlive) with this board's
  exact status-file path reads as an orphan and would be ended each minute and respawned.
- The program is read from the COMMAND LINE (argv), not the kernel's executable name (review 6 asked). Rejected: a
  portable fixture needs a real executable whose own file is named `kosmos-tunnel` (a copied /bin/sleep is killed by
  code signing, a symlink reports its target, a hard link to node cannot load its libraries). What argv alone lets
  through: a same-user process with parent 1 whose argv names the tunnel, `run` and this board's exact status-file path.
  Argv is read flattened, so with a space in the path (`Application Support`) a tunnel whose status file is
  `<path> more` matches too (review 7); the same conditions still hold for it.
- Kept an hour per pid (review 7; for good before): "not our tunnel". "Ended" is asked again after a minute (review 6: a tunnel that ignores
  TERM). Never judged while the board itself is pid 1 (a container entrypoint). Asked again after a minute (review 5): a live parent (its board
  may die later) and a pid that is gone (it may be reused by one). A failed ps: next time.
- Not on Windows (no command line is read there), nor on Linux where a subreaper makes an orphan's parent other than
  1: such an orphan is not ended. It still alternates on the relay as before, AND (new with part 6, review 5) its
  writes to the status file refuse gated remote actions until this board's child's own write has been seen once.
  To shorten that, status() (read often, for the page) notes the child's write too. Stated on #6669.
- Not tested: the read at tunnel start (startChild); the same function, reached by status() and the capability read,
  is.

## Release pinning (review 6)
The relay half is stacked on sessioniat-6595 (relay #489). A connector with #489 but not runcaps makes every gated
remote action refused under this board. Merge runcaps right after #489 and before any Kosmos release cuts a connector.

## Weakest premise
The pid check: a pid reused by an unrelated process that writes a status file in the board's 0600 data dir. Anything
that can write there can already rewrite the board's own token.

## Cost, stated
Requires the relay half in the bundled connector. A connector with #489 but not runcaps lists nothing while it runs,
so gated remote actions are refused until both ship (fail closed). Each status write is read once per gated request
(a small local file).
