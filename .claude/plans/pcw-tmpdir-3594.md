# pcw-tmpdir-3594 (#3594)

## Problem
tools/test-promote-channel-win.sh reds (2 FAILs) wherever TMPDIR ends in "/", and is green in
CI. Measured red on Agent1s and on Mortals over SSH (both have TMPDIR=/var/folders/.../T/).

## Cause (measured)
macOS TMPDIR ends in "/". `mktemp -d "${TMPDIR}/promote-win-test.X"` keeps the "//", and
two assertions compare that path as a string to the record path the gate prints. The gate
builds it with node's path.join, which collapses "//". Bisect: e113b8707 green;
9ceed2477 (09-12, which added the two assertions) red with the slashed TMPDIR and green with
TMPDIR=/tmp. So the test was born red wherever TMPDIR ends in "/".

## Change
Strip trailing slashes from TMPDIR before mktemp, using the same loop tools/release.sh uses.
Test-only; no product code changes.

## Rejected
- Normalizing inside the gate or the promote script: they are right (path.join output is
  canonical). The test built a non-canonical expectation.
- Comparing with `tr -s /` at each assertion: it fixes two sites and leaves T itself
  non-canonical for the next assertion someone adds.

## Weakest premise
That the trailing slash is the only difference. Measured: with TMPDIR=/tmp, origin/main is
0 FAILs, so the slash is sufficient to explain both.

## Siblings (review iteration 1 asked whether the class is wider)
Already measured today: the full test:shell chain ran on Mortals over SSH with
TMPDIR=/var/folders/8g/.../T/ (trailing slash). Every test passed except this one (and, on
Agent1s only, the tests that call /usr/bin/python3, which the unaccepted Xcode license blocks,
#3578). So no other test:shell member carries this bug.

## Deferred
TMPDIR="/" exactly: the loop keeps "/", so mktemp gets "//promote-win-test.X". That is not a
realistic TMPDIR, and it matches release.sh's guard.
