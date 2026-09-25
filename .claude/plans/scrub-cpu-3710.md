# scrub-cpu-3710: bound the #1760 scrub test on CPU time

## Why
`engine/feedbacksend.test.js` "#1760 scrub survives a multi-MB degenerate
assignment run without throwing" guards against unbounded regex backtracking,
which is CPU work, but measured wall time (`Date.now()`) against 3000ms. On a
busy Mac it failed whole validation runs on branches that do not touch
feedbacksend (4189ms, 4404ms, 3564ms, 3984ms, 3434ms at 1-minute loads of 16
to 31 on 10 cores) and passed alone in 267 to 354ms. It blocked every agent's
validation gate while the Mac was busy.

## Change
- A `cpuMsOf(fn)` helper: `process.cpuUsage()` delta, user + system, in ms.
- The scrub test bounds CPU ms < 3000 (same number). The no-throw assertion is
  unchanged.
- A standing control test: `/^(a+)+$/` on 24 a's plus '!' must measure >= 500ms
  of CPU (measured ~1.15s), so the measure provably sees backtracking.

## Verified
- Under 20 busy loops on 10 cores (load ~22), the same scrub call measured
  wall 1410 / 1424 / 1430ms and CPU 486 / 474 / 477ms: wall is what load
  inflates, CPU is steady.
- Perturbation: an exponential regex planted at the top of `scrub()` makes the
  test fail (11677ms), so the CPU bound still catches a real regression. File
  restored from HEAD afterwards.
- Both tests pass alone.

## Decided
- Keep 3000ms: CPU time for the call is ~270 to 490ms, so the margin is 6x.
- Rejected raising the wall-time bound: it moves the failure to a busier Mac
  and weakens the guard.
- Rejected skipping under load: a guard that turns itself off when the box is
  busy protects nothing exactly when many agents run suites.

## Weakest premise
`process.cpuUsage()` counts the whole process, including GC threads; a heavy
concurrent GC in the same test process could add CPU. The file's tests run in
one process sequentially, so nothing else in-process runs during the call.
