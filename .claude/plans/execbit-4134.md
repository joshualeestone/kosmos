# execbit-4134: a pre-merge guard that the bundle's executable files are executable in git (#4134)

## Why

#4043 committed bin/agy-report-bridge.js as 100644. tools/build-kosmos-bundle.sh `chmod +x`'s it, and
the cut's step 4b (release_bundle_matches_tree) refuses a bundle file whose executable bit differs
from the tree's. Nothing before the cut looked at a file's git mode, so the 0.7.01 cut found it.

## The change

1. `bundle.execbit-4134.test.js` (root, so run-tests.sh's `*.test.js` glob and CI run it): reads the
   build script, pairs every `chmod +x "$STAGE/..."` with the `cp` that placed it, and asserts every
   `$REPO/...` source is 100755 in `git ls-files -s`. A `cp` from outside the tree is skipped; a chmod
   target no `cp` accounts for FAILS (a new shape must be taught, not skipped). The one exception is
   `runtime/bin/node` (extracted from the Node download), named with its reason, and the test fails
   if that name stops appearing.
2. `bin/agy-report-bridge.js` to 100755, the same blob as Baron's agybit-0701 (so the two merge clean).

## Arms

- Real red: on origin/main the first test names bin/agy-report-bridge.js 100644, the incident's file.
- Control: a real temp git index with one 100644 and one 100755 file: only the 100644 one is named.
- Control: the real script with one bridge read as 100644 names that bridge alone.
- Control: an untraced chmod target fails; a non-tree cp source is traced and skipped.

## Not in this change

install/setup.sh's only `chmod +x` is on the built app binary, not a tree file, so the install side
has nothing to guard. The card said "bundle and install scripts"; this is why only one is read.

## Weakest premise

The parser reads single-line `cp "<src>" "$STAGE/<dst>"` shapes. A cp written another way (a loop, a
variable destination) is not paired, and its chmod target then fails as untraced, which is loud, not
silent. A cp that is NOT followed by chmod but copies a 100755 file is out of scope: cp keeps the
mode, so bundle and tree agree.
