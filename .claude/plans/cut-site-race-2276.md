# cut-site-race-2276: make the release cut survive a concurrent chaoskosmos-site merge

**Card:** kosmos#2276 (rotation: 2276 mod 6 == 2).

## Problem

`tools/release.sh` step 7b commits this version's site release files and pushes
them to chaoskosmos-site `origin/main`. Agents merge chaoskosmos-site PRs through
GitHub while a release cut is running, so `origin/main` can move between the cut
reading the local site HEAD and pushing it, and the push is rejected
non-fast-forward. The only recovery 7b offered was a manual `git pull --rebase`
plus a re-cut (a forced version bump, because the bundle is not byte-reproducible)
- a routine race turned a cut into an aborted release.

## Why the obvious fixes do not work

- **`git pull --rebase` in the script:** the site checkout is SHARED and carries
  other agents' in-progress page work (release.sh:873); a rebase needs a clean
  tree, so it would fail on or disturb a colleague's uncommitted edits.
- **A local lock:** the merges that cause the race happen on GitHub, not through
  this script, so a local lock cannot serialize against them.

## The fix

Extract the push into `tools/lib/site-push.sh` as `site_push_with_replay`,
mirroring `tools/lib/release-freeze.sh`'s extract-a-race-sensitive-step-for-
testability pattern. On a non-fast-forward rejection it:

1. fetches `origin/main` (updates the ref only; no working-tree touch),
2. builds a tree in a TEMPORARY index (`GIT_INDEX_FILE`): `read-tree` the fetched
   tip, then `update-index --cacheinfo` to overlay ONLY the release-owned paths
   from our commit,
3. `write-tree` + `commit-tree` that onto the fetched tip, sets `SITE_SHA` to the
   new commit, and retries the push - bounded (5 attempts).

None of `read-tree`/`update-index`/`write-tree`/`commit-tree`/`ls-tree`/`fetch`
touch the shared checkout's working tree or real `.git/index`. A concurrent PAGE
merge (design/*.html, index.html - never the release paths) is preserved; only the
release paths come from our commit. `SITE_SHA` (what step 8 archives and deploys)
is updated to the actually-pushed commit. A push failure that is NOT a
non-fast-forward (auth, protected ref) aborts immediately with git's own message
rather than burning the retries.

## Decisions

- **Replay-via-plumbing over rebase-and-retry** (the card's hint): rebase is unsafe
  on the shared checkout; the plumbing replay is the only approach that survives a
  GitHub-side merge without disturbing anyone's uncommitted work.
- **Two known limitations documented, routed to the cut owner (Baron):** a
  concurrent edit to a release-owned path (most plausibly versions.html) is silently
  overlaid; and local main is left diverged after a replay, so later cuts take the
  slow (replay) path. Both stem from the cut committing on the shared local main.
  The robust fix (build the release commit on a freshly-fetched origin/main so local
  main never diverges) reshapes 7b and is a design call for the cut. The common
  #2276 race (a page/design merge) is unaffected by either. **Weakest premise:** that
  concurrent edits to a release-owned path are rare enough to accept documenting
  rather than blocking; if versions.html edits during a cut turn out common, the
  robust fix should be prioritized. Merge is held for Baron's review.

## Tests

`tools/test-site-push-race-2276.sh` drives the real `site_push_with_replay` against
scratch repos with an actual concurrent merge: the push survives; origin/main
carries both the merge and the release files; the colleague's uncommitted work and
the real index are untouched; the clean case does not replay; the bounded case
refuses rather than looping; a relative reindex_dir is refused. Red-capable (a
force-push variant reds the merge-survived and no-replay assertions). Wired into
`package.json` `test:shell`.
