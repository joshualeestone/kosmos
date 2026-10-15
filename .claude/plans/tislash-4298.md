# tislash-4298: test-install's sandbox path must not carry '//'

The 0.7.51 staging cut failed at step 4b (10-15 17:02, frozen dfe29ecb3): 15 login-job checks in tools/test-install.sh
failed, nothing was published. Cause, measured from the gate log: #4298 (82504594ae) changed `SB="$(mktemp -d)"` to
`SB="$(mktemp -d "${TMPDIR:-/tmp}/test-install.XXXXXXXXXX")"`. macOS's TMPDIR ends in '/', so $SB became
`.../T//test-install.X`. install/setup.sh squeezes repeated slashes out of KOSMOS_HOME (`tr -s '/'`, line 110) before
hashing it into the board's login-job label; the harness hashes "$SB/home" as written (BOARD_LABEL_SUFFIX, line 594).
Different strings, different hashes: the harness looked for a plist named for the raw path, setup.sh wrote one named
for the squeezed path. The port-16180 check followed from the uninstall not finding "its" job.

## Fix
Squeeze TMPDIR's slashes the way setup.sh does, drop the trailing '/', fall back to /tmp when that leaves nothing
(TMPDIR=/), and refuse to run (removing the made directory) if $SB still has '//'. Probed: /var/folders/x/T/, /x//y/,
/x//, /, unset and /tmp all give a clean path. The #4298 static guard still passes (the call is templated).

## Review
r1 sonnet: cause confirmed (label hash, KOSMOS_HOME, baked launcher home, plist greps, pgrep inventory all compare
equal once $SB has no '//'); MINOR the refusal leaked the made dir and a '//' in TMPDIR's middle was refused rather
than fixed -> squeeze + rmdir; MINOR TMPDIR=/ templated at the root -> /tmp fallback; NIT the plan cited the full
harness run before it finished (it is cited below only once green).

## Rejected
- Hashing a squeezed path in the harness: it would hide a real divergence the next time setup.sh's normalisation
  changes; the harness should hand setup.sh a path it does not need to normalise.
- Fixing every tools/test-*.sh template: the others do not compare a path against setup.sh's normalised form; out of
  scope for a fix merged under a release hold (Splinter allowed THIS fix only).

## Weakest premise
That nothing else in test-install.sh depended on the '//' form. The reviewer read every comparison; the full harness
run decides it.

## Proof
tools/test-install.sh run in full on Agent1s after the fix; the #4298 guard; Mortals validation.
