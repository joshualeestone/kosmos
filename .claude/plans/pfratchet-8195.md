# pfratchet-8195: a ratchet on early readers under pipefail, repo-wide

Card: kosmos#8195. Stacked on sweeppipe-8193 (#8198), which adds test-support/early-readers.js.

## Decision (on the card)
The triage found no non-test site that is a measured live false fail today, so the shipping scripts are not
rewritten, with two exceptions found in review round 1 (below). Instead, a ratchet: today's hits (382 entries plus 4 header lines, after review round 1) become test-support/pipefail-baseline-8195.txt, and
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

## Review round 1 (decided)
- Files are chosen by `set ... pipefail` or `bash ... pipefail` outside a comment (a subshell counts), or #!, plus
  every tools/lib/ file (sourced under pipefail). The first version matched the word anywhere, so a comment could
  add or drop a file. An anchored-to-line-start version silently lost install/setup.sh (`... && set -o pipefail`).
- The 17 tools/lib/ hits this added were read. Two are rewritten to grep -c:
  - release-freeze.sh: `printf "$expected" | grep -q '^app/engine/'` refuses a freeze if it false-fails. Measured
    0/200 at today's 11 KB list, 50/50 at 128 times that: it would start refusing good cuts as the bundle grows.
  - browser-check-surface-gate.sh: the branch's commit messages into grep -qiE; a false fail reads as no trailer.
  Tests: test-browser-check-surface-gate.sh and test-release-detached.sh rc=0; release-freeze-notice and
  bundle.execbit node tests 12/12.
- One failure message now prints NEW and GONE together, and names a listed line that changed.

## Review round 2 (decided)
- Scripts are every tracked *.sh plus any tracked file whose #! names a shell (install/kosmos, .githooks/*,
  install/pkg-scripts/postinstall), with a CONTROL that .githooks/prepare-commit-msg is read. They add no hits today.
- `set +o pipefail` (turning it off) no longer counts: the pattern needs `-...o pipefail`.

## Review round 3 (decided)
- The pattern takes `-o <name>` pairs, so `set -o errexit -o pipefail` counts; a unit control lists the spellings
  seen and the ones not seen (+o, comments).
- browser-check-surface-gate.sh line 168 (`printf "$files" | grep -qE`) stays listed on purpose: a false fail there
  makes the gate REFUSE (the safe direction), while line 149's false fail meant "no trailer", which skips checks.
