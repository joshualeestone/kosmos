# muserun-flake-4159: the #3939 round-1 test stops racing its own launcher

Card: kosmos #4159 (claimed:johnnycage, Liu Kang m1425: outranks the #718 state PRs, because it
failed every full `yarn test` on Mortals on 2026-09-27: state-1 twice, the iOS-only state-2 branch
once, notif-icon-4151 once).

## The race
`engine/muserun.test.js`, "#3939 round 1: at the timeout, what the launcher started is stopped too".
The turn timeout is 300 ms. On a loaded machine it fires before the fake launcher has run
`sleep 6 &` and written `child.pid`, so the process group is stopped with no child in it and the
test dies on `readFileSync(pidFile)` with ENOENT, not on the behaviour it checks.

## Finished looks like
- The timeout stays 300 ms (Liu Kang: fix the race, do not raise the timeout).
- A turn where the launcher never started its child is recognised (no pid file) and run again, up to
  5 times; the group-stop assertions run on a turn where the child did start.
- If the child never starts in 5 turns, the test fails saying the case did not run, never passes
  without having checked anything.
- Proved with a forced delay (the launcher sleeps 1 s before starting its child): main's test red
  with the card's ENOENT; this test green when only the first launch is slow; this test red with
  "did not run" when every launch is slow.

## Challenge loop
- Iteration 1: the child counts as started only when the pid file holds an integer above 1. The
  stop can land after the shell created the file and before echo wrote it, and `Number('')` is 0,
  which `process.kill` reads as the test runner's own process group: the old cleanup could have
  SIGKILLed the whole `yarn test`. Proved with a launcher that leaves the file empty: it fails with
  "did not run" and the runner survives. A 5 s deadline makes that message beat the 8 s test timeout.

## Rejected
- Raising the timeout (my first cut, 1500 ms): a bigger margin, not a fix, and it slows the test.
- Reading the launcher's own pid instead: the launcher can be stopped before its first line too, so
  the same race stays, one step earlier.

## Weakest part
Five tries is a bound picked by judgement: a machine loaded enough to delay a shell's start by
300 ms five times running fails the test, correctly saying it did not run, rather than flaking.
