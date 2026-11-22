# selftestwait-8879: the download self-test's refused-folder waits

## Why
The 0.8.14 staging cut failed step 4 (2026-11-21 21:26 CST) on 4 rows of the native app's download self-test
(#5167), all in the refused or read-only Downloads arms. The same test passed 74 of 74 on a quiet Mortals at 21:45,
and the installed 0.8.13 app failed the same 4 rows at 21:2x, so it is intermittent and not 0.8.14's code.
The arms chmod the download folder to 0500, then wait for WebKit's "Cannot create file" in 0.1 s polls, 50 tries
(5 s). When the tries ran out they carried on silently (and whenDenied restored the folder), so a late answer
showed up only as four unrelated-looking FAIL rows.

## What
native-app/main.swift, the three waits (whenAsked twice, whenDenied once):
- each ends by the uptime clock (ProcessInfo.systemUptime, so a wall-clock step cannot end it early), 15 s
  (refusedWaitSeconds) after it began, instead of after 50 polls. A poll count is not a
  time: 150 polls of 0.1 s measured about 34 s each on Agent1s (review 3). A wait still returns the moment the answer
  arrives.
- a wait that runs out prints `download selftest WAIT RAN OUT (kosmos#8879): waited Ns without "Cannot create file"
  number N (seen M)`, N being the measured time, and then goes on as before (whenDenied still restores the folder).
  The rows still give the verdict.
- native-app.download-5167.test.js: the watchdog assertion's message names the new worst case, and a new source
  test pins the time bound, the uptime clock, no poll-count bound, and that the ran-out line contains none of the
  bundle build's case-arm tokens for this gate (read from the script). Red both ways: a "TIMED OUT" in the line, and
  `whenAsked(1, 50)` back, each fail it.

## Rejected
- A poll count (150 x 0.1 s, then 300 x 0.1 s): it does not measure time. Measured, the all-run-out run took 174 s
  at "15 s" and 277 s at "30 s", so each wait really ran about 2.2 times its nominal length.
- 30 s per wait: too close to the 300 s watchdog and the build's 360 s alarm for no measured need.
- Exiting with "download selftest TIMED OUT" when a wait runs out: build-kosmos-bundle.sh reads that as "the gate could
  not judge", which would relabel a real product regression (the system's reason never said) as the gate's fault.
- Raising the watchdog and the alarm instead: two more places changed, for no case that needs it.

## Weakest premise
That the late "Cannot create file" is timing, and 15 s covers it. Nobody measured how late it came on 11-21. If it
recurs, the WAIT RAN OUT line now says which wait and how many answers had come, which separates "slow" from
"never came".

## Checks (Agent1s, idle, 22:5x CST, the final code)
- swiftc to the floor target, as build-kosmos-bundle.sh does: no errors.
- the real self-test: 74 of 74 rows pass, 74 s, no WAIT RAN OUT line.
- red arm 1 (scratch copy, the counter matching a string never said): all three waits print "waited 15s", 74 rows
  pass, 129 s.
- red arm 2, the worst case (that, and no expected file ever counted as saved), measured on the wall-clock version
  just before: 9 rows wrong, judged ("download-check: 9 row(s) wrong", exit 1), not timed out, 215 s, under the
  300 s watchdog.
- native-app.download-5167.test.js: 37 of 37.
