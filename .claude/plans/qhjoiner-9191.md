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
- `kill_waiters`: KILLs every process whose command line has `--queued-args $S/` (byte-wise, LC_ALL=C), called in the
  EXIT trap before $S is removed and in the watchdog's KILL stage. Every wrapper this file runs writes its arguments file
  under $S (TMPDIR=$S/tmp, or another dir under $S), so the pattern names this run's waiters only.

## Verified
- Defect 2 (the card's reproduction): a stray process whose ps line is `/bin/bash <REAL_QH> --queued-args /tmp/stray`,
  alive for the whole run. Control: `pgrep -o` picks it (measured). With the fix: 175/175, the two named arms and the
  live-holder arm OK, and the stray left alone (it is not this run's).
- Two earlier runs read 174/1 on the #9118 HUP arm. Cause: my launcher, perl with `$SIG{HUP}="IGNORE"`, which every
  process of the test inherits, so the wrapper that arm HUPs could not be stopped. Launched with setsid alone: 175/175.
- Defect 1 is NOT reproduced: TERM to the file early and during the gitlive arm, on main's version and on this one,
  left no waiter in either. The card's orphan most likely came through the watchdog's KILL stage (no EXIT trap runs
  there), which this change now sweeps; that path is reasoned, not measured.

## Decisions
- Find the joiner by parentage, not by a unique path (the card's other option): the arm already holds its background
  pid, and a per-run copy of queued-heavy.sh would change what the arms test.
- Weakest premise: that every waiter this file starts writes its arguments file under $S. The wrappers all run with
  TMPDIR inside $S here (line 23 and the two arms that set their own TMPDIR under $S).
