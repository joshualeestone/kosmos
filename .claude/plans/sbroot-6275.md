# sbroot-6275 (kosmos#6275: a CI guard against reverting the test-install SB-root fix)

Card: joshualeestone/kosmos#6275, point 1 (point 2, normalization parity, was resolved by #6272).

## The gap
tools/test-install.sh (the cut's install gate, step 4b) hashes "$SB/home" as written into the board's login-job
label; install/setup.sh squeezes repeated slashes out of KOSMOS_HOME and drops a trailing one first. macOS's TMPDIR
ends in '/', so a harness that templates at "$TMPDIR/x" puts '//' in $SB and the two labels differ (#6252, a
regression of #4298). The suite and CI run under run-tests.sh's TMPDIR, which has no trailing slash, so a revert of
the fix passes everything until the next cut.

## What this branch adds
- tools/test-install-sbroot-6275.sh: lifts, as written in their files, the harness's sandbox-root derivation (from
  `_ti_tmp="$(printf ... TMPDIR` to the `SB="$(mktemp -d` line, and the '//' refusal after it when present) and its
  `BOARD_LABEL_SUFFIX=` line and its first `export KOSMOS_HOME=` (the install that label is for), and setup.sh's two
  KOSMOS_HOME normalization lines and its `_board_label=` line, which must be identical everywhere setup.sh computes it
  (setup.sh's under sh, as it runs, with the harness's export). Under a macOS-shaped TMPDIR (trailing '/'), an interior '//', and a plain one
  (control), each must make a new $SB under the squeezed TMPDIR with no '//', and the two labels must be equal.
  A built-in negative control removes the slash handling from the lifted block and must see '//' and two labels.
- package.json test:shell runs it (beside test-mktemp-template-4298.sh), so the suite and CI do.

## Measured
- Passes under this shell's TMPDIR (which itself ends in '/') and under TMPDIR=/tmp/.
- Real-file mutants in a scratch copy, each red for its own reason: the harness hashing "$SB//home" (labels differ, all
  three arms; review 1 found the first version blind to this); the trailing-strip and tr -s removed (the harness's
  refusal fires, shown with its text); those plus the refusal removed (the #4298 shape: "$SB has '//'"); the harness
  exporting KOSMOS_HOME="$SB/home2" while hashing "$SB/home" (labels differ; review 2); setup.sh's second label line
  made different from the first (the lift refuses; review 2); a new top-level KOSMOS_HOME rewrite in setup.sh (a
  `pwd -P` after the two lifted lines: the pinned count of 3 refuses; review 3); the derivation grown past 8 lines (its
  own message). An equivalent rewrite of BOARD_LABEL_SUFFIX to hash "$KOSMOS_HOME" passes, since the harness side runs
  the harness's export (review 3).

## Known limits (reviews, accepted)
- Only the harness's FIRST KOSMOS_HOME export is used; a second export just before the label line would not be seen.
- A later reassignment of $SB after the lifted block is not seen.
- setup.sh's label lines are compared as text, so a harmless respelling of one of them fails (on the safe side).
- Only label lines spelled `_board_label="com.kosmos.board.$(printf` are lifted and compared; a third one spelled another
  way would be neither (review after the rebase).
- The KOSMOS_HOME pin counts `KOSMOS_HOME=` at a line start or after a space or ';' (export, readonly and local
  included), comments left out; an assignment spelled another way (read, eval, printf -v) is not counted.
- tools.every-test-runs.test.js passes; control: with the package.json entry removed it names this file.
- tools/test-mktemp-template-4298.sh: 0 failures (the scratch dir is templated under TMPDIR).

## Decided
- Lift the code rather than restate it, so the test follows the two derivations as written; a lift that finds nothing
  fails its own floor instead of passing vacuously.
- No TMPDIR=/ arm: it would make a real folder under /tmp; the fallback is one line and not what regressed.
