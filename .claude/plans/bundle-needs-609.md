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

## Review round 1 (blind), what changed

- The comparator now runs at the cut BEFORE the first copy toward the site (`tools/release.sh`, after the tunnel sha is read from the built tarball and before step 5), on the built bytes; 9b still runs it on the served bytes. A file the build forgot stops the cut with nothing published instead of being caught after step 8 deployed it.
- The "could not derive" guard was unfalsifiable (four pinned names were always printed). Now the derivation refuses (2, with the reason on stderr) a tree without `web/` or `engine/`, and refuses when node is absent or the require walk throws; the comparator reads that 2 directly (not through a pipe) and additionally requires the derived set to name a `web/` file and an `engine/` file. Two new cases: no node on PATH, a tree without `engine/`.
- `app/bin/kosmos-tunnel` is left out of the expected set (the engine resolves it by path, but the connector is the checksum argument's to judge, never the tree's), so the connector contract is unchanged.
- The orphaned doc comment moved back onto `release_bundle_matches_tree` and says the other direction; the header lists `release_bundle_expected_files`.
- The derivation control names a web file and an engine file (both derived), not the pinned `bin/kosmos`; the second `nobin.tgz` is `noroot.tgz`.
- Deferred: a `join(__dirname,` wrapped across lines is not seen by the line-based grep (none in the tree; `bundle.contents.test.js` covers the multi-line shape); `require('./dir')` to an index file is not followed (none in the tree).
- The real-build control (a `cp` line dropped from `tools/build-kosmos-bundle.sh` reds the early comparator on a real build) runs once the Mac is free of the 0.5.24 cut; its transcript goes in the proof.
