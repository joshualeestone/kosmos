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
ignoring the running list (both red), dropping the pid check (one red).

## Not closed (review 1, stated)
- A tunnel orphaned by an EARLIER board that still forwards: it writes the same status file, and its pid is not this
  board's child, so its file is ignored, but it is the one forwarding. Neither check describes it. The fix is to end
  such orphans when a board starts its own tunnel: kosmos#6669 (R01c), mine.

## Weakest premise
The pid check: a pid reused by an unrelated process that writes a status file in the board's 0600 data dir. Anything
that can write there can already rewrite the board's own token.

## Cost, stated
Requires the relay half in the bundled connector. A connector with #489 but not runcaps lists nothing while it runs,
so gated remote actions are refused until both ship (fail closed). Each status write is read once per gated request
(a small local file).
