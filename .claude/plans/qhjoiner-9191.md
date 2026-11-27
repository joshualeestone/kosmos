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
  stage, before the sleep sweep (so a waiter cannot start a sleep after it). The watchdog's KILL stage now kills, in
  order, the file's children (one by one, leaving itself out), this run's waiters, this run's sleeps (last, so nothing
  still alive can start one after the sweep), then the file. It leaves itself out (its own pid from `exec sh -c 'echo $PPID'`, bash 3.2 having no
  BASHPID; perl was used in round 6, swapped in round 8 so a missing perl cannot leave it empty and make the watchdog
  kill itself), so its last `kill -KILL` of the file still runs; the old `pkill -P` matched the watchdog itself where pkill
  does not leave out its caller's parent (procps, Linux). Two kinds: a process whose command line has `--queued-args $S/` (byte-wise, LC_ALL=C), which covers every arm
  whose TMPDIR is under $S; and a pid listed in the file $S/own-waiters. Both are KILLed only when the command line has
  a waiter's shape (a bash running a script with --queued-args; for a listed pid also its forms before the re-exec,
  perl about to run this tree's wrapper, or that wrapper with its first arguments, since it is listed only while its
  own arm runs; a separate "a script in $S" branch was dropped in round 7, as nothing real could reach it). The stale-TMPDIR arm (#5467) needs the second kind:
  its TMPDIR does not exist, so the wrapper falls back to /tmp and the arguments file is outside $S. That arm now runs
  as `( ... exec perl ... ) &` and lists its pid (the waiter's, through perl's exec and the wrapper's re-exec) only
  while it runs (between the fork and its listing, and between the wait and its unlisting, a stop would miss or keep it;
  both windows are a few instructions). A file rather than a variable, because the watchdog is
  forked before any arm and would only ever see an empty variable. As a background job that arm's stdin is /dev/null,
  which it already redirected nowhere; its exit code (wait), output and 60 s alarm are unchanged.
- `joiner_under` takes an optional command prefix, so its regression arm can use a fake script path.
- Three regression arms (EXPECTED 175 -> 178): kill_waiters ends a stand-in whose arguments file is in $S and a listed
  one in each form the real stale-TMPDIR waiter has (re-exec'd, before it with REAL_QH pointed at the fake path for
  that one call, and perl), and leaves a LISTED pid that is not a waiter of this run alone (CONTROLS, measured: with the
  reused-pid guard removed, the REAL_QH branch removed, or the perl branch removed, the arm reads BAD); joiner_under picks the arm's own stand-in over an OLDER one with the same command line,
  with a CONTROL that `pgrep -o` picks the older; and a source check that the three #5923 arms call joiner_under and that
  no `pgrep -o -f "^/bin/bash $REAL_QH` pick is left (on origin/main's file the same greps read 0 and 3, so it would be
  BAD there). Since round 9 it checks each arm passes its OWN background pid (glw/GLR, ilw/ILR, wp/LIVE; CONTROL: a
  copy with GLR swapped for ILR in the gitlive arm reads 2, not 3). It reads the file by an absolute path ($SELF): $0 is relative when the file is run the way package.json
  and CI run it, and the file cds away, so a "$0" version read nothing and was BAD in place (measured at round 4:
  177 OK, 1 BAD; round 5's reviewer found it). Stand-ins are named after a fake script, so no real queue scan on the Mac matches them.
- `own_waiter` / `unown_waiter`: an arm lists its waiter only while it runs and takes off only its own line when its
  wait returns (kill_waiters also accepts a listed pid's pre-exec forms, which is safe only for a pid still its own).

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
- The new arms alone, in a small harness: all OK after each round (3 arms from round 4).
- The three #5923 arms are not run with a stray beside them (that needs a real-path stand-in, which other agents'
  queue scans on the Mac would see); the source check above is what catches a call site reverted to pgrep -o.
- Whole file after rounds 2 and 3: 177/177 each; after round 5, run as CI runs it (`bash tools/...`, a relative
  $0): 178/178.
- The watchdog's KILL stage in a harness built from the file's own watchdog and kill_waiters (a 2 s deadline, a
  foreground sleep the TERM cannot interrupt, a waiter stand-in in $S): the stand-in is gone and the file ends. Round 6
  code: KILLed (137). Round 7 code (children first): the foreground sleep is one of those children, so the file's TERM
  trap then runs (124) before the KILL is needed. macOS only; the Linux pkill case is reasoned.
- Whole file after rounds 6, 7 and 8: 178/178 each. Watchdog harness re-run on round 8's sh-based pid: stand-in gone,
  file ended (124).
- Whole file after round 1: 177/177.
- Disclosed: the planted stray for the reproduction ran about 25 minutes (22:15-22:40 CST) with a real
  `.../queued-heavy.sh --queued-args` command line, so other agents' lib-move scans could see it and say "another
  queued-heavy.sh is live" (they then join on the old lib and run; nothing is held). The regression arm avoids that.

## Decisions
- Find the joiner by parentage, not by a unique path (the card's other option): the arm already holds its background
  pid, and a per-run copy of queued-heavy.sh would change what the arms test.
- Residual, kept: a listed pid is KILLed in the forms this tree's wrapper takes. While the stale-TMPDIR arm's pid is
  listed, it is this shell's own child and the shell is blocked in `wait` on it, so it cannot be reused until that wait
  reaps it; the next statement unlists it. The only gap is those few instructions, and a run of THIS worktree's
  queued-heavy.sh would have to take that exact pid in them.
- Weakest premise: that the stale-TMPDIR arm is the only one whose arguments file leaves $S. Checked: of the three arms
  that set their own TMPDIR, the other two (the stdin and noexec arms) set it to an existing dir under $S. A later arm
  that points TMPDIR outside $S would need to record its pid the same way.
