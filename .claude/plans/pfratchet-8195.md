# pfratchet-8195: a ratchet on early readers under pipefail, repo-wide

Card: kosmos#8195. Stacked on sweeppipe-8193 (#8198), which adds test-support/early-readers.js.

## Decision (on the card)
The triage found no non-test site that is a measured live false fail today, so the shipping scripts are not
rewritten. Instead, a ratchet: today's 370 hits (83 files) become test-support/pipefail-baseline-8195.txt, and
shell.pipefail-ratchet-8195.test.js fails on any NEW hit and on any listed line that is gone.

## Change
- shell.pipefail-ratchet-8195.test.js: scans `git ls-files '*.sh' install/kosmos` that set pipefail, multiset
  compare against the baseline; controls that the list and scan are real; a unit control for the comparison.
- test-support/pipefail-baseline-8195.txt: generated, one `path<TAB>line` per hit.

## Measured
- 2 tests pass on this tree.
- Perturbation add (a new `printf x | grep -q y` in verify-served.sh): red, the line named.
- Perturbation gone (a listed verify-served.sh line rewritten to grep -c): red, "no longer exist".

## Not covered
A script that gets pipefail only from whoever sources it; the helper's known gaps; a writer that grows
(a listed line that was safe while its writer was small).
