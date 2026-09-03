# kosmos#1942: a contention refusal in the browser-run guard test must not read as a failure

Branch: `browser-guard-contention-skip-1942` (joshualeestone/kosmos). Claimed on the night shift.

## The defect (precisely measured, not inferred)

`tools/test-browser-run-guard.sh` tests `kosmos_refuse_if_browser_run_live`
(`tools/lib/cut-guard.sh:240`). On this shared Mac, when ANOTHER agent's real
`browser-checks.sh` is live, the test prints reds that have nothing to do with the branch:

```
FAIL  passes when nothing is live (rc=1, out=another browser-checks run is already live ... (pid 16716) ...)
FAIL  does not refuse itself (rc=1, out=... pid 16716 ...)
FAIL  #1391 descendant not excluded (rc=1): ... pid 16716 ...
```

MECHANISM: the guard has TWO detection arms. `marker_other = _kosmos_marker_other_live
browser` (the #1796 cookie arm) is checked UNCONDITIONALLY at cut-guard.sh:273
(`... || [ -n "$marker_other" ]`), even when a seam probe (`KOSMOS_BC_PROBE`) is set. The
seam arms above drive the PROBE (expecting rc=0, "no refusal"), but a real foreign browser
run's MARKER fires `marker_other`, so the guard refuses (rc=1) and the arm reads FAIL. The
real-pgrep delta arm (KOSMOS_BC_REALPATH=1, skipped in the suite) fails the same way under
contention. Confirmed: without REALPATH and with NO foreign run live, the test exits 0 "all
clear"; the 3 reds appear only when a foreign `browser-checks.sh` is live (pid named in the
message).

The guard is RIGHT and stays (concurrent Playwright genuinely interferes; refusing a real
cut is correct). The defect is that the TEST's contention refusal is indistinguishable from
an assertion failure - which costs every agent the diagnosis and trains them to discount
reds (a real red sat under four merges tonight because each author's own checks were green).

## The fix: a contention SKIP that is not a failure (test-level, guard untouched)

In `tools/test-browser-run-guard.sh`, add a CONTENTION PRE-CHECK using the guard's own
reliable signal: is a foreign marked browser run live (`_kosmos_marker_other_live browser`
non-empty, i.e. a real `browser-checks.sh` this test did not start)? The arms that assert
the guard does NOT refuse (rc=0 expected) are exactly the ones a foreign marker breaks; the
arms that assert a refusal (rc=1) are fine under contention.

- If a foreign browser run is detected: SKIP the rc-0-expecting arms with a LOUD, distinct
  message NAMING the conflicting pid - "SKIP  <arm>: another browser run is active (pid N),
  this arm needs an idle box" - and do NOT count them as failures.
- Exit 0 on a contention-only skip (with the loud skip printed), so the `test:shell` `&&`
  chain (package.json) continues and the full-suite summary stays green - satisfying the
  card's #3 (the summary must not count a contention skip as a failure) without touching
  run-tests.sh, because an exit-0 test is already not a failure to the `&&` chain.
- A real assertion failure (rc mismatch with NO foreign browser live) still FAILs and exits
  1, exactly as today.

Why this does NOT mask a real red (the card's core hazard): the skip fires ONLY when a
foreign browser MARKER is positively present (a real `browser-checks.sh` running that this
test did not fork). A genuine bug in the self-exclusion/refusal logic carries no foreign
marker, so it still FAILs; and the skipped arms run normally on an idle box and in isolated
CI (no contention, both agents confirmed green there), so the coverage loss is only under
contention, where the arm's verdict is untrustworthy anyway.

## Card done-conditions

1. Contention refusal != test failure: distinct SKIP line naming the conflicting pid. DONE by
   the pre-check + skip.
2. "Consider a lock with a wait" - considered and DROPPED for v1: the arms are a fast unit
   test, not a Playwright run; queuing them behind a foreign browser run (which can last
   minutes) to run 3 assertions is worse than a clean, loud skip. The card says "consider",
   and the skip already delivers the trustworthy-signal outcome. Flagged on the card.
3. The full-suite summary must not count a contention skip as a failure: DONE - the test
   exits 0 on a contention-only skip, so the `&&` chain and the tally stay green.

## Tests (control-bearing)

The test file IS the test. Prove the new behavior by SIMULATING a foreign marked browser run
(set the marker the way a real browser-checks.sh does, from a pid this test did not fork) and
asserting the rc-0 arms SKIP (not FAIL) with the pid named and the script exits 0; and a
CONTROL with NO foreign marker where the same arms run and a deliberately-broken guard still
FAILs (exit 1) - so the skip cannot mask a real red. Mirror how the file already seams the
marker/probe.

## Out of scope
- The guard function's real behavior (correct, stays).
- The other guards' contention handling (cut/harness) - same pattern, separate cards if wanted.
- A lock-with-wait mechanism (considered, dropped; see #2).
