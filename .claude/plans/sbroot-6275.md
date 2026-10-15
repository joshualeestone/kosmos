# sbroot-6275 (kosmos#6275: a CI guard against reverting the test-install SB-root fix)

Card: joshualeestone/kosmos#6275, point 1 (point 2, normalization parity, was resolved by #6272).

## The gap
tools/test-install.sh (the cut's install gate, step 4b) hashes "$SB/home" as written into the board's login-job
label; install/setup.sh squeezes repeated slashes out of KOSMOS_HOME and drops a trailing one first. macOS's TMPDIR
ends in '/', so a harness that templates at "$TMPDIR/x" puts '//' in $SB and the two labels differ (#6252, a
regression of #4298). The suite and CI run under run-tests.sh's TMPDIR, which has no trailing slash, so a revert of
the fix passes everything until the next cut.

## What this branch adds
- tools/test-install-sbroot-6275.sh: lifts the harness's REAL derivation (from `_ti_tmp="$(printf ... TMPDIR` to the
  `SB="$(mktemp -d` line, and the '//' refusal after it when present) and setup.sh's REAL two normalization lines, then
  runs them under a macOS-shaped TMPDIR (trailing '/'), an interior '//', and a plain one (control). Each must make a
  new $SB under the squeezed TMPDIR with no '//', and setup.sh must leave "$SB/home" as the harness hashes it.
  A built-in negative control removes the slash handling from the lifted block and must see '//' and differing labels.
- package.json test:shell runs it (beside test-mktemp-template-4298.sh), so the suite and CI do.

## Measured
- Passes under this shell's TMPDIR (which itself ends in '/') and under TMPDIR=/tmp/.
- Real-file reverts in a scratch copy: the trailing-strip and tr -s removed (the refusal fires: 2 arms red); those
  plus the '//' refusal removed (the #4298 shape: "$SB has '//'", 2 arms red, plus the negative control).
- tools.every-test-runs.test.js passes; control: with the package.json entry removed it names this file.
- tools/test-mktemp-template-4298.sh: 0 failures (the scratch dir is templated under TMPDIR).

## Decided
- Lift the code rather than restate it, so the test follows the two derivations as written; a lift that finds nothing
  fails its own floor instead of passing vacuously.
- No TMPDIR=/ arm: it would make a real folder under /tmp; the fallback is one line and not what regressed.
