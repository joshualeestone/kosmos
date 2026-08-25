# bundle-needs-609: the served-bundle comparator checks both directions

## Finished looks like
`release_bundle_matches_tree` (tools/lib/release-freeze.sh, release.sh step 9b) reds when a
file the tree and the app need is absent from the served bundle, naming it. The expected set
is derived, never copied from the build's hand list: the server's local require graph, every
non-test engine/*.js in the tree, the files the engine resolves under bin/ by path, everything
under web/, and the pinned relocations (bin/kosmos, app/bin/kosmos-report-hook.sh, the icon
when present). tools/test-release-detached.sh drops one file per source and proves each red,
with a complete bundle green as the control. A real build with a cp line removed reds the
comparator (done by hand for the PR).

## Why
#609: the comparator walked the files IN the bundle, so a cp line dropped from
build-kosmos-bundle.sh produced a bundle that passed 9b. Tonight's #731 was that class: the
bridge was never added to the list, every served bundle lacked it, creation failed on every
install for a day, and served == built said fine.

## Not in this change
runtime/** and VERSION (not tree files). The pkg (its own guard). Whether the build's list
should itself be derived (it stays explicit; this makes the omission visible at the cut).
