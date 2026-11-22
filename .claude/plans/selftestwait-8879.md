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
- bound 150 tries (15 s) instead of 50 (5 s). A wait still returns the moment the answer arrives.
- a wait that runs out prints `download selftest WAIT RAN OUT (kosmos#8879): 15s without "Cannot create file"
  number N (seen M)` and then goes on as before (whenDenied still restores the folder). The rows still give the verdict.

## Rejected
- 30 s per wait: measured, the run where all three run out took 277 s against the 300 s watchdog (and the build's
  360 s alarm). Too close. At 15 s the same run took 174 s. The 103 s difference is more than the 45 s the
  longer waits add; that is measured, not explained, so the 15 s figure rests on the 174 s run, not on arithmetic.
- Exiting with "download selftest TIMED OUT" when a wait runs out: build-kosmos-bundle.sh reads that as "the gate could
  not judge", which would relabel a real product regression (the system's reason never said) as the gate's fault.
- Raising the watchdog and the alarm instead: two more places changed, for no case that needs it.

## Weakest premise
That the late "Cannot create file" is timing, and 15 s covers it. Nobody measured how late it came on 11-21. If it
recurs, the WAIT RAN OUT line now says which wait and how many answers had come, which separates "slow" from
"never came".

## Checks (Agent1s, 22:1x to 22:2x CST, idle box)
- swiftc to the floor target, as build-kosmos-bundle.sh does: no errors.
- the real self-test: 74 of 74 rows pass, 73 s, no WAIT RAN OUT line.
- red arm (scratch copy, the counter matching a string never said): all three waits print WAIT RAN OUT, the run
  finishes in 174 s, below the 300 s watchdog.
