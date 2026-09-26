# release.sh: a re-cut of the same .99 version is not "staying on the line"

**Branch:** `recut-at-99` · Found by the Mac 0.6.99 re-cut (2026-09-26 14:36 CDT)

## What happened

The first 0.6.99 cut aborted at step 3 (a real red on main, fixed by #4026) AFTER step 2 had
bumped main to 0.6.99. The retry, `release.sh 0.6.99`, was refused in 0 s by the end-of-line
guard: "0.6.99 is the last of the 0.6 line: the next version is 0.7.00, not 0.6.99". The guard
reads the current version from package.json (now 0.6.99) and refuses anything but the next line's
first version, so a cut that aborts after its bump at a .99 could never be retried.

## The change

One condition in tools/release.sh's .99 arm: it no longer refuses when the requested version EQUALS
the current one (`[ "$V" != "$_prev" ]`). That is a re-cut of the same release, which the rest of
the cut already treats as idempotent (step 2 does not re-bump). Every other request at .99 is still
refused (the existing "staying on the line is refused" test still passes), and publishing a build
that is already served is refused by its own guard (tools/lib/cut-rerun-guard.sh), not this one.

## Tests

tools.release-gate.test.js: "standing at 0.6.99, a RE-CUT of 0.6.99 gets through" (reaches the
next thing the script needs, no refusal, package.json untouched). Red check: main's release.sh fails
it. The 0.2.99 arm (a finished line) is left as is.

## Weakest premise

That nothing else relied on the .99 guard to stop an accidental second cut of 0.x.99 AFTER it was
published. The cut-rerun guard is meant to own that; if it did not, a re-cut of an already served
0.x.99 would now reach it rather than stop here.
