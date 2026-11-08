# sbrootctl-8244: a negative control that can fail on ubuntu-26.04 (kosmos#8244, steps 2 and 3)

## Problem
tools/test-install-sbroot-6275.sh's negative control runs the reverted (#4298-shape) derivation under a TMPDIR ending in
'/' and expects '//' in $SB, as macOS's mktemp gives. On ubuntu-26.04 the reverted derivation made no '//' (measured
from run 42473275263's own log: .../mac/test-install.K1qIOtpPkb), so mktemp there returns the path squeezed, and the
control could show nothing. Step 1 (branch pin2404-8244) pinned the shell shards to ubuntu-24.04 meanwhile.

## Step 2 (this branch)
- MACOS_MKTEMP: a mktemp -d stand-in, defined only inside the runs that ask for it, that makes the folder at the
  template exactly as given (ten X's filled in), as macOS does; it refuses any other call shape.
- CONTROL: the stand-in keeps the '//' it is handed.
- New arm: the fixed derivation under the stand-in still gives no '//' and one label (the fix squeezes before mktemp).
- The NEGATIVE CONTROL runs under the stand-in, so it shows the defect whichever mktemp the machine has.
- The three original arms keep the platform's real mktemp.

## Measured here
With a PATH mktemp that squeezes '//' (standing in for 26.04's): origin/main's test fails exactly as CI did ("the
reverted derivation had no '//'"), and this branch passes, its negative control catching the revert.

## Step 3 (tried, then backed out of this PR)
The unpin ran in this PR's CI on ubuntu-26.04 (run on head 6592d4c3e5): tools/test-install-sbroot-6275.sh PASSED there
(its negative control caught the revert; the stand-in kept '//'), but tools/test-light-side-4911.sh failed on 26.04
only ("stand-in ... is not running", "the real matcher missed a browser executable"). As this plan said, the PR was not
widened: the unpin commit is reverted, so this PR lands step 2 alone, on the pinned ubuntu-24.04. The unpin waits for
that test to work on 26.04 (its own card).

## Also
The stand-in's random suffix reads a fixed 256 bytes (a pipe that relied on SIGPIPE hung under a parent ignoring
SIGPIPE, measured in review); checked to pass with SIGPIPE ignored and to leave no tr running.

## The unpin is a gate for the whole shards
Unpinning puts every Linux shell command back on ubuntu-latest (26.04, uutils coreutils by default), not only this
test. This PR's own CI run is the gate for all of shells 1/2 and 2/2: if anything else turns red there, re-pin rather
than widen this PR.

## Weakest premise
That squeezing in mktemp is the only 26.04 difference that matters to this test. The log shows mktemp's output; my PATH
stand-in reproduces it; the real 26.04 run in step 3 is the check.
