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
refused (the existing "staying on the line is refused" test still passes). It only brings .99 in
line with every other version: nothing in release.sh refuses V equal to the current version
elsewhere.

⚠️ Corrected in review round 1: I first wrote that re-publishing an already-served build is refused
by tools/lib/cut-rerun-guard.sh. It is not: that lib is the step-3 isolation rerun and never looks
at a version. What actually stands in the way of re-cutting a PUBLISHED version is (a) step 1b's
versions-entry stamp window (an entry already on the page carries its old publish stamp) and
(b) step 7's byte compare against a local dist/kosmos-$V-arm64.tar.gz, which fires only on a box
that has that file. Neither is a served-version check, and the comment in release.sh now says so.

## Tests

tools.release-gate.test.js: "standing at 0.6.99, a RE-CUT of 0.6.99 gets through" (reaches the
next thing the script needs, with no refusal). Red check: main's release.sh fails it. The 0.2.99 arm
(a finished line) is left as is.

## Weakest premise

That letting V equal the current version through at .99 opens nothing new. It does not: the same
request was already allowed at every other version, and the only protection against re-cutting a
published version is the stamp window and the box-local byte compare named above, which apply here
exactly as they do everywhere else. A real served-version check would be a separate change.
