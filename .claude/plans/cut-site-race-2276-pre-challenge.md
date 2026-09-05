---
pre_challenge: true
method: challenge-loop
branch: cut-site-race-2276
diff_hash: e3e8c396281afd0e4e3498ddeb6eb7027fffdf474ad7b810863b272800c898eb
validation: passed
subdir_audit: passed
timestamp: 2026-09-05T21:22:02Z
iterations: 2
converged: true
rebased: 2026-09-05T21:22Z onto origin/main (Baron approved; main had moved). diff_hash recomputed on the new base; site-push test re-run green on the rebased HEAD; only the package.json test:shell line reconciled (main's entries + the site-push entries).
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2 found zero BLOCKER / WARNING / CONVENTION findings)
**Total findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Fixed:** 4 NITs | **Deferred (documented, routed to cut owner):** 2 WARNINGs | **Asked:** 0

Change: kosmos#2276 - the release cut's step 7b site push was not robust to a
chaoskosmos-site PR merging mid-cut (origin/main moves, push rejected
non-fast-forward, recovery was a manual pull --rebase + a re-cut). Extracted the
push into tools/lib/site-push.sh (site_push_with_replay): on a non-fast-forward
rejection it replays ONLY the release-owned files onto the fetched tip via a
TEMPORARY index (read-tree + update-index --cacheinfo + write-tree + commit-tree),
touching neither the shared checkout's working tree nor its real index, then
retries bounded. SITE_SHA is updated to the pushed commit (what step 8 archives).
A non-race push failure aborts immediately. Validation: the full node suite is
green (4659 pass, 0 fail) and tools/test-site-push-race-2276.sh passes (13/13,
red-capable), both run locally after the release cut freed the box; wired into
package.json test:shell.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKER, 2 WARNING, 0 CONVENTION, 3 NIT.
- WARNING: a concurrent merge editing a release-owned path (e.g. versions.html) is
  silently overlaid. DEFERRED + documented: scoped out of the #2276 page-merge case;
  the robust fix reshapes 7b and is the cut owner's design call. A naive collision
  check would false-fire on our own prior replays (see WARNING 2).
- WARNING: local main is left diverged after a replay, so later cuts take the slow
  (replay) path. DEFERRED + documented: self-heals (the deploy uses the returned
  sha), not a correctness failure; fixing it safely means not committing on the
  shared local main - a cut redesign for the owner.
- NIT (fixed): retry ONLY a genuine non-fast-forward; abort other push failures
  (auth/protected ref) immediately with git's message instead of burning retries.
  This also keeps git's routine rejection hint off the operator's terminal.
- NIT (fixed): refuse a relative reindex_dir up front (git resolves a relative
  GIT_INDEX_FILE against the -C dir), with a red-capable test.
- NIT (fixed): documented both known limitations in the lib header.

#### Iteration 2
**New findings:** 0 BLOCKER, 0 WARNING, 0 CONVENTION, 1 NIT. **Converged.**
- The blind reviewer actively tried to break the plumbing and could not: replay
  tree contents correct (concurrent file survives + release files present), nothing
  touches the shared checkout, SITE_SHA downstream sound, push discrimination correct
  both directions ([remote rejected] with a leading space correctly does NOT match
  \[rejected\]), bounded loop correct, ls-tree parse safe, test genuinely red-capable,
  and the known-limitations comment verified accurate (not false).
- NIT (fixed): force LC_ALL=C on the push so the rejection-text discrimination is
  locale-independent.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | tools/lib/site-push.sh (overlay) | concurrent edit to a release-owned path silently overlaid | Deferred | documented + routed to Baron; out of scope for the page-merge case |
| 2 | 1 | WARNING | tools/release.sh 7b | local main left diverged after a replay -> later cuts take the slow path | Deferred | documented; self-heals, deploy uses the returned sha |
| 3 | 1 | NIT | tools/lib/site-push.sh push | non-race failures burned all retries + noisy hint | Fixed | capture stderr, discriminate non-ff vs other, abort others |
| 4 | 1 | NIT | tools/lib/site-push.sh entry | relative reindex_dir would misplace the temp index | Fixed | absolute-path guard + red-capable test |
| 5 | 1 | NIT | tools/lib/site-push.sh header | limitations undocumented | Fixed | added the two-limitation note |
| 6 | 2 | NIT | tools/lib/site-push.sh push | discrimination grep locale-dependent | Fixed | LC_ALL=C on the push |

### Outstanding questions (ASKED)
None. The two deferred WARNINGs are documented and routed to Baron (the cut owner)
as a design decision on the merge PR; the merge is held for his review. They are
deferrals, not blocking asks: the code is correct for the scenario #2276 targets.

### NITs
All four fixed (see ledger).

### Strengths
- The unsafe-in-a-shared-checkout rebase is avoided entirely: the replay uses a
  temp index and commit-tree, so no colleague's uncommitted page work is touched.
- The test drives the REAL extracted function against scratch repos with an actual
  concurrent merge, and is red-capable (a force-push variant reds it).
- Extract-to-lib + wire-into-test:shell matches release-freeze.sh; the two edge-case
  limitations are named in the code and routed to the owner rather than hidden.
