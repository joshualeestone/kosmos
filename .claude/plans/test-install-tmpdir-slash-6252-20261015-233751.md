# test-install-tmpdir-slash-6252 -- strip a trailing slash from the SB sandbox root (#6252)

## Problem (verified on this base)
#4298 templated tools/test-install.sh's sandbox dir to `SB="$(mktemp -d "${TMPDIR:-/tmp}/test-install.XXXX")"`.
In a cut shell macOS TMPDIR ends in "/", so SB carried a double slash. test-install.sh derives the board
plist name by HASHING the literal path `"$SB/home"` (BOARD_LABEL_SUFFIX = shasum of that text), and
setup.sh normalizes KOSMOS_HOME (strips a trailing slash) before it hashes, so the double slash made the
two derivations disagree and the 0.7.51 install gate (step 4b) failed. The suite and CI run under
run-tests.sh's kt-sandbox TMPDIR (no trailing slash), so it was green there and in CI. Confirmed by Liu
Kang on Mortals with the same built bundle: b6fd626e9 with a trailing-slash TMPDIR = 364 pass / 51 fail;
b6fd626e9 without = 415/0; the fix with a trailing-slash TMPDIR = 415/0.

## Design (the narrowest fix; Liu Kang m5892/m5894)
Capture the root into `_sbroot` and strip one trailing slash, keeping the `${TMPDIR:-/tmp}` default and the
#4298 static guard's positional-template shape:
  _sbroot="${TMPDIR:-/tmp}"
  SB="$(mktemp -d "${_sbroot%/}/test-install.XXXXXXXXXX")"
Scope held to this one line plus a cause comment, for a fast 0.7.51 re-cut. No regression test in this PR.

## Done when
1. test-install.sh under a trailing-slash TMPDIR passes (install gate 4b green). -> PM-proven 415/0.
2. The static guard tools/test-mktemp-template-4298.sh still passes (the new shape accepted). -> 0 failures.
3. The `${TMPDIR:-/tmp}` default is kept (unset TMPDIR -> /tmp). -> confirmed by expansion + review.

## Weakest part of my reasoning (named)
`${_sbroot%/}` strips only ONE trailing slash, while setup.sh also squeezes repeated slashes (`tr -s '/'`).
A TMPDIR with an interior or doubled `//` would still drift. A real macOS cut shell never produces that
(exactly one trailing slash), so the real failure is fixed; the residual is a non-occurring hand-set value.
Filed as the #6252 follow-up: a CI/unit check that exercises a trailing-slash TMPDIR, and optionally
matching setup.sh's full normalization at the hash site.
