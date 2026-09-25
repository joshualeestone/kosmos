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
- A `cpuMillisecondsOf(fn)` helper: `process.cpuUsage()` delta, user + system, in ms.
- Both scrub timing tests (the degenerate run, and its sibling long non-URL
  run, which had the same wall-time shape) bound CPU ms < 3000 (same number).
  The no-throw assertion is unchanged.
- A standing control: a fixed 1e8-iteration loop must
  measure between 20 and 3000ms, so cpuMillisecondsOf provably reports milliseconds.
  Review iteration 1 replaced a regex control: its cost depended on V8
  interpreting a regex on first use (86ms once compiled to native), so a V8
  or flag change could red it with the instrument fine.

## Verified
- Under 20 busy loops on 10 cores (load ~22), the same scrub call measured
  wall 1410 / 1424 / 1430ms and CPU 486 / 474 / 477ms: load inflated wall time ~5x (vs ~270ms alone)
  and CPU time ~1.7x, well inside the 3000ms bound.
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
CPU time is not load-proof either: it rose ~1.7x under load 22 (efficiency
cores, cache contention). The bound keeps ~6x headroom over that, measured, not
infinite. And `process.cpuUsage()` counts the whole process, including GC
threads; the file's tests run sequentially in one process.

## Controls run
- Exponential regex planted in `scrub()`: the degenerate-run test fails (11677ms).
- cpuMillisecondsOf with no division (microseconds) and with /1e6 (seconds): the control
  test fails both ways.

## Review iteration 2
- CI runner (macos-latest, image macos-26-arm64) ran the degenerate scrub in
  510ms of WALL time on main (run 36125175797). Its CPU time was NOT measured
  there; process CPU can exceed wall time (parallel GC threads), so the runner's
  headroom is an inference until this PR's CI run reports the new tests. The
  control's CI duration is checked on this PR's run.
- The same wall-time shape is in 10 more guards across 4 files; filed as
  kosmos#3715 with every site. Only #1760's was seen failing, so converting the
  rest (with per-guard perturbations) is its own reviewable change.
- `cpuMsOf` renamed `cpuMillisecondsOf`.

## Review iteration 3
The control's comment and message carried a per-machine CPU figure that a
reviewer measured at about half in the test's own shape; the figure, the
"wide enough for a much slower machine" assurance (untrue under --jitless) and
an always-true assertion were deleted rather than restated. The control now
says only what it checks, and fails for microseconds, seconds, and fn never
called (all three perturbations run).
