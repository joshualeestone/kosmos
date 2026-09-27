# execbit-4134: a pre-merge guard that the bundle's executable files are executable in git (#4134)

## Why

#4043 committed bin/agy-report-bridge.js as 100644. tools/build-kosmos-bundle.sh `chmod +x`'s it, and
the cut's step 4b (release_bundle_matches_tree) refuses a bundle file whose executable bit differs
from the tree's. Nothing before the cut looked at a file's git mode, so the 0.7.01 cut found it.

## The change

1. `bundle.execbit-4134.test.js` (root, so run-tests.sh's `*.test.js` glob and CI run it): reads the
   build script, pairs every `chmod +x "$STAGE/..."` with the `cp` that placed it, and asserts every
   `$REPO/...` source is 100755 in `git ls-files -s`. A `cp` from outside the tree (the connector, the
   Node runtime) is skipped; a chmod target no earlier `cp` accounts for FAILS, and so does any other
   line running `chmod` in a shape the parser does not read (a new shape must be taught, not skipped).
2. `bin/agy-report-bridge.js` to 100755. Since landed on main as #4142 (40b4530d), so after the merge
   of main this branch carries only the test.

## Arms

- Real red, measured on origin/main at d586f361 (before #4142): the first test named
  bin/agy-report-bridge.js 100644, the incident's file. Main is green now that #4142 has landed.
- Control: a real temp git index with one 100644 and one 100755 file: only the 100644 one is named.
- Control: the real script with one bridge read as 100644 names that bridge alone.
- Control: an untraced chmod target fails; a non-tree cp source is traced and skipped.

## Not in this change

install/setup.sh's only `chmod +x` is on the built app binary, not a tree file, so the install side
has nothing to guard. The card said "bundle and install scripts"; this is why only one is read.

## Weakest premise

The parser reads single-line `cp "<src>" "$STAGE/<dst>"` and `chmod +x "$STAGE/<dst>"` shapes. A cp
written another way is not paired, so its chmod target fails as untraced; a chmod written another way
(`chmod 755`, a variable path, a loop) fails as unread. A mode set by something that is not `chmod`
(`install -m 755`, a tar extract into $STAGE) is not seen at all: none exists in the script today.
The test reads git's index, which is what a merge carries; the cut reads the checked-out file, so
an unstaged `chmod -x` in a working tree is not seen here.

Pairing is by line order, with no model of `if`/`else`: a chmod is credited to the last cp above it
whichever branch runs. Today the only path with two cps (runtime/bin/node, one per branch) takes
both from outside the tree, so both are skipped either way. A future path copied from the tree in
one branch and from elsewhere in the other could be checked against the wrong source.

A cp that is NOT followed by chmod but copies a 100755 file is out of scope: cp keeps the mode, so
bundle and tree agree.
