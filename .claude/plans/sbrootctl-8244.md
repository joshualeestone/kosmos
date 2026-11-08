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

## Step 3 (this branch, after the pin merged as 405f013c64)
Unpinned: .github/workflows/test.yml, linux.yml, tools/test-ci-runner-route-5488.sh and tools/test-ci-created-url-6742.sh
restored to their pre-pin text (c2690b1bf5; only the pin's three commits touched them since), so this PR's own CI runs
the shell shards, and this test, on ubuntu-latest (26.04): that run is the proof the control works there.

## Also
The stand-in's random suffix reads a fixed 256 bytes (a pipe that relied on SIGPIPE hung under a parent ignoring
SIGPIPE, measured in review); checked to pass with SIGPIPE ignored and to leave no tr running.

## Weakest premise
That squeezing in mktemp is the only 26.04 difference that matters to this test. The log shows mktemp's output; my PATH
stand-in reproduces it; the real 26.04 run in step 3 is the check.
