# cutnotes-7411: the cut's bundle check knows app/release-notes.json

**Why:** the 0.7.73 staging cut stopped at step 4b (2026-10-28 17:03 CDT, kosmos#1050). The sandboxed install passed (165/0),
then release_bundle_matches_tree refused "not in the tree: app/release-notes.json". tools/build-kosmos-bundle.sh writes
that file (kosmos#7411 step 1, merged that morning), so the tree has no file of that name. Nothing was served.

## Change

- tools/lib/release-freeze.sh, release_bundle_matches_tree: for app/release-notes.json, make the notes again from the
  frozen tree with the build's own command (tools/whats-new-pool.js notes <version> --platform=mac, the tree's pool) and
  require them byte-identical. A tree without the tool refuses (it cannot vouch for notes); a tool that fails refuses.
- tools/test-release-detached.sh (in test:shell): a matching bundle passes; edited notes are caught and named; a tree
  without the tool refuses; a control that the fixture's notes were made by the real tool. Shown red on the unfixed
  check (3 failures, the first being the cut's exact error).

## Decisions

- Regenerate and compare, not skip: a skip would let a stale or edited notes file ship. Rejected: an allowlist entry.
- --platform=mac: this check runs only on the Mac tarball (release.sh step 4b); Linux builds its own notes (--platform=linux).
- The other direction (the bundle MUST carry release notes) is not added: not needed to unblock the cut, and the build
  already fails if it cannot write them.

## Weakest premise

That the build and the check run the same tool on the same pool, so identical output means a correct file. Both read
the frozen tree, so they cannot see different pools; a nondeterministic notes order would make this red, the loud way.
