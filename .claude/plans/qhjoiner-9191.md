# qhjoiner-9191: test-queued-heavy-4977 watches its own joiner, and ends its own waiters

Card: #9191.

## Finished looks like
A waiter left alive by an earlier run of tools/test-queued-heavy-4977.sh (or any process whose command line looks like
`/bin/bash <this worktree>/tools/queued-heavy.sh --queued-args ...`) no longer makes the #5923 lock-loop arms watch the
wrong process. And a run that ends through its EXIT trap or its watchdog's KILL stage ends the --queued-args waiters
whose arguments file is in its own $S.

## Done
- `joiner_under <pid>`: walks the children of an arm's own background job (at most 8 levels) to its --queued-args
  waiter. Replaces the three `pgrep -o -f "^/bin/bash $REAL_QH --queued-args"` picks: the gitlive and idxlock arms the
  card names, and the live-holder arm, which had the same shape.
- `kill_waiters`: KILLs this run's waiters, called in the EXIT trap before $S is removed and in the watchdog's KILL
  stage. Two kinds: a process whose command line has `--queued-args $S/` (byte-wise, LC_ALL=C), which covers every arm
  whose TMPDIR is under $S; and a pid an arm recorded in OWN_WAITERS, KILLed only while it still runs --queued-args.
  The stale-TMPDIR arm (#5467) is the one that needs the second kind: its TMPDIR does not exist, so the wrapper falls
  back to /tmp and the arguments file is outside $S. That arm now runs as `( ... exec perl ... ) &` and records its pid,
  which stays the waiter's pid through perl's exec and the wrapper's re-exec.
- `joiner_under` takes an optional command prefix, so its regression arm can use a fake script path.
- Two regression arms (EXPECTED 175 -> 177): kill_waiters ends a stand-in whose arguments file is in $S and a recorded
  one, and leaves another alone; joiner_under picks the arm's own stand-in over an OLDER one with the same command line,
  with a CONTROL that `pgrep -o` picks the older. Stand-ins are named after a fake script, so no real queue scan on the
  Mac matches them.

## Verified
- Defect 2 (the card's reproduction): a stray process whose ps line is `/bin/bash <REAL_QH> --queued-args /tmp/stray`,
  alive for the whole run. Control: `pgrep -o` picks it (measured). With the fix: 175/175, the two named arms and the
  live-holder arm OK, and the stray left alone (it is not this run's).
- Two earlier runs read 174/1 on the #9118 HUP arm. Cause: my launcher, perl with `$SIG{HUP}="IGNORE"`, which every
  process of the test inherits, so the wrapper that arm HUPs could not be stopped. Launched with setsid alone: 175/175.
- Defect 1 is NOT reproduced: TERM to the file early and during the gitlive arm, on main's version and on this one,
  left no waiter in either. Where the card's orphan came from is not known (the watchdog's KILL stage, or the
  stale-TMPDIR arm's 60 s alarm, are both candidates). What is measured is that kill_waiters ends both kinds of
  stand-in (the new arm); that it ends the card's exact orphan is reasoned.
- Two new arms alone, in a small harness: 2 OK.
- Disclosed: the planted stray for the reproduction ran about 25 minutes (22:15-22:40 CST) with a real
  `.../queued-heavy.sh --queued-args` command line, so other agents' lib-move scans could see it and say "another
  queued-heavy.sh is live" (they then join on the old lib and run; nothing is held). The regression arm avoids that.

## Decisions
- Find the joiner by parentage, not by a unique path (the card's other option): the arm already holds its background
  pid, and a per-run copy of queued-heavy.sh would change what the arms test.
- Weakest premise: that the stale-TMPDIR arm is the only one whose arguments file leaves $S. Checked: of the three arms
  that set their own TMPDIR, the other two (the stdin and noexec arms) set it to an existing dir under $S. A later arm
  that points TMPDIR outside $S would need to record its pid the same way.
