# pfratchet-8195: a ratchet on early readers under pipefail, repo-wide

Card: kosmos#8195. Uses test-support/early-readers.js, which #8198 put on main.

## Decision (on the card)
The triage found no non-test site that is a measured live false fail today, so the shipping scripts are not
rewritten, with two exceptions found in review round 1 (below). Instead, a ratchet: today's hits (381 entries plus 4 header lines, after review round 5) become test-support/pipefail-baseline-8195.txt, and
shell.pipefail-ratchet-8195.test.js fails on any NEW hit and on any listed line that is gone.

## Change
- shell.pipefail-ratchet-8195.test.js: scans `git ls-files '*.sh' install/kosmos` that set pipefail, multiset
  compare against the baseline; controls that the list and scan are real; a unit control for the comparison.
- test-support/pipefail-baseline-8195.txt: generated, one `path<TAB>line` per hit.

## Measured
- The ratchet passes on this tree.
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

## Review round 5 (decided)
- browser-check-surface-lib.sh bc_surface_token_hits: the changed diff body into grep -qE, under a caller's pipefail
  (run-tests.sh, bc-surface-map.sh). A false fail reads as "token not changed", so the gate skips a check: the unsafe
  direction, which my round-1 read missed. Now grep -c. Measured: the old line 30/30 false on a 400 KB diff (review),
  the new one 0/30 on 410 KB, and an absent token still not found. Three surface tests rc=0.
- A way to regenerate the list (round 7 corrected it: see below).

## Review round 7 (decided)
- KOSMOS_WRITE_PIPEFAIL_BASELINE=<path> writes the list, header included, to that path. Printing it to stdout did
  not work: node's own result lines follow it, so the output could not replace the file.
- A tracked extensionless file missing from disk now fails like a *.sh one does, rather than being skipped.
