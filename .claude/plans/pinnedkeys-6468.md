# pinnedkeys-6468: the build reads the pinned keys from a relative stage (0.7.57 cut fix)

## What failed
Baron's 0.7.57 cut (freeze 5c1b97d235 + bump f2283eeb23) stopped at step 4: "could not read the pinned keys from
app/engine/manifest-verify.js (#6468)". tools/build-kosmos-bundle.sh sets STAGE="$OUT/kosmos-bundle" = dist/kosmos-bundle
(RELATIVE), and `node -e 'require(process.argv[1])' dist/...` resolves a bare relative path as a PACKAGE, not a file.
Measured both ways: relative -> "Cannot find module 'dist/kosmos-bundle/app/engine/manifest-verify.js'"; absolute -> the
one pinned key. Baron's hand test used an absolute path, which is why it passed outside the cut. The line sent node's
stderr to /dev/null, which hid the cause.

## Finished looks like
The build reads the pinned keys from the relative stage a real cut uses; a failure shows node's own error; a test
runs the build's own lines with a relative STAGE and would have failed before the cut.

## Done
- tools/build-kosmos-bundle.sh: the path is made absolute in the shell (cd + pwd) AND resolved in node; node's stderr is
  shown with the FAIL line (first 8 lines) instead of dropped.
- tools.pinned-keys-read.test.js: lifts the build's lines verbatim and runs them from a temp folder with STAGE=dist/
  kosmos-bundle (reads the pinned keys); a CONTROL runs the 0.7.57 line and shows it reads nothing; a planted load
  failure refuses AND prints its cause. Mutant restoring the old line: the main arm goes red.
- Searched: no other shell-embedded require() of a path from argv or env in build-kosmos-bundle.sh, release.sh,
  test-install.sh or tools/lib/*.js (the other #6468 reads use readFileSync, which resolves relative paths from cwd).

## Verified
- tools.pinned-keys-read.test.js 3/3; every test file reading build-kosmos-bundle.sh + tools.every-test-runs 245/245;
  test-bundle-names-6468 pass.

## Why the earlier checks missed it
The build's manifest writer was exercised by hand with KM_PINNED_KEYS passed in, and the pinned-key read itself was
only ever run with absolute paths; test-install.sh's update block needs a built bundle and never ran before the cut.

## Review log
### Iteration 1 (opus): 0 BLOCKERs, no code WARNINGs (converged)
- [WARNING] (state, not code) the reviewer read the tree before the commit landed (MOOT: committed and pushed 61bc071d80)
- [NIT] a missing app/engine folder exits via the shell cd error, not the FAIL line (ACCEPTED: kosmos_bundle_odd_names already refuses a stage without app/); CDPATH exported in a cut would make the cd print and the read refuse visibly (ACCEPTED: fails safe)
- Checked: no other shell-embedded require() of an argv/env path in build-kosmos-bundle.sh, release.sh, test-install.sh; manifest-sign.js loads the verifier via __dirname; run-tests.sh globs root *.test.js.
