# pcw-tmpdir-3594 (#3594)

## Problem
tools/test-promote-channel-win.sh reds on every Mac (2 FAILs) and is green in CI.

## Cause (measured)
macOS TMPDIR ends in "/". `mktemp -d "${TMPDIR}/promote-win-test.X"` keeps the "//", and
two assertions compare that path as a string to the record path the gate prints. The gate
builds it with node's path.join, which collapses "//". Bisect: e113b8707 green;
9ceed2477 (09-12, which added the two assertions) red with the slashed TMPDIR and green with
TMPDIR=/tmp. So the test was born red on every Mac session.

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
