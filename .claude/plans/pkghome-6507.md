# pkghome-6507: the .pkg checksum test sandboxes HOME for every arm (#6507)

## What failed
tools/test-pkg-checksum-1670.sh was red on Mortals only (ARM 4 transient-then-match rc=96, ARM 4 cleanup, CONTROL
#4319). #6474 sandboxed HOME in run_arm, but ARM 4 (line ~269) and CONTROL #4319 (~284) run the lifted block directly,
with the REAL $HOME. Mortals' own install is 0.7.57, whose engine/manifest-verify.js has run-setup, so the block handed
off to it (and got 96 from the test server); Agent1s is on 0.7.55 (no verifier), so it took the checksum path and passed.
Reproduced on Agent1s with HOME pointed at a decoy 0.7.57-style install: the same 3 FAILs.

## Finished looks like
The test passes whatever install the person running it has; a guard proves it.

## Done
- tools/test-pkg-checksum-1670.sh: `export HOME="$T/nohome"` for the whole test (run_arm still uses ARM_HOME).
- tools.pkg-checksum-home-6507.test.js: runs the shell test with HOME = a decoy home holding a checker-capable install
  (asserts the decoy has run-setup, so it would hand off); expects all checks passed. Mutant removing the export: red.

## Verified
- Decoy HOME (the Mortals condition): all checks passed (was 3 FAIL); real HOME: all checks passed; guard 1/1.

## Against my own work
#6474's review asked for HOME sandboxing "for every arm"; I sandboxed run_arm and did not check the arms that bypass it.
The test was green on the Mac that had no checker installed, which is the only Mac it ran on before merge.
