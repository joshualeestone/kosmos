---
pre_challenge: true
method: challenge-loop
branch: 1548-abort-rollback
diff_hash: 404d894153d57185fbb1ddea7472f147d5ed334b1ade95257d8b365b20d7b215
validation: passed
subdir_audit: passed
timestamp: 2026-08-30T12:47:44Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4 returned zero NEW BLOCKERs/WARNINGs/CONVENTIONs)
**Total findings:** 12 (0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 8 NITs)
**Fixed:** 7 | **Deferred:** 5 | **Asked (awaiting user):** 0

The single most valuable catch was iteration 2's WARNING: my first implementation
backed the pre-cut pointer up as `dist/*.precut` INSIDE the shared, deployable site
checkout. That left an untracked ~48 MB file in shared space for the whole cut window,
where a stray `git add -A` by another agent would stage it into the next `git archive
HEAD` deploy export -- the exact #1548 bug (an abandoned build reaching deploy) arriving
by a different door. The fix moved the backup OUT of the site checkout entirely, under
`$BUILD_ROOT/precut/`, which the EXIT trap removes on every path. The finding is bigger
than the card: a deploy path had an untracked file sitting in shared space at all.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 2 NITs
- [WARNING] test-site-restore-1548.sh:45 -- ARM4 tautological (never called release_site_restore) --> FIXED (14c80d90). ARM1 is itself the control that goes red if restore breaks.
- [CONVENTION] .claude/plans/ -- no plan file for branch --> DEFERRED: worktree created by hand for a small release-tooling fix.
- [NIT] release.sh:322 / release-freeze.sh:327 -- "step 5" imprecise (overwrite is the tail of step 4) --> FIXED (14c80d90).
- [NIT] release.sh success manifest -- .precut prints as untracked noise each clean cut --> DEFERRED then resolved by iteration 2's relocation.

#### Iteration 2
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
- [WARNING] release.sh:553 -- .precut sits untracked in the SHARED site checkout; a stray `git add -A` could stage it into a deploy --> FIXED (8e099dc6): backup moved under BUILD_ROOT/precut, auto-cleaned by the trap, no separate success-path cleanup.
- [NIT] release-freeze.sh:277 -- usage line stale (did not document had_ptr) --> FIXED (8e099dc6): now documents both new args.
- [NIT] test:22 -- .sha256 restore/remove unasserted --> FIXED (8e099dc6): every arm now asserts the pair.

#### Iteration 3
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 0 new NITs
**Duplicates of prior findings:** 1
- [WARNING] release.sh:324 -- stale comment still described the rejected "beside it as .precut" design; could mislead a maintainer into reintroducing the shared-checkout hazard --> FIXED (72869081).
- [NIT] release.sh:326 -- _ptr_had keyed on the tarball alone --> DUPLICATE of iteration 2's deferred concern; deferral holds (theoretical, requires an already-broken served pair, .sha256 regenerable, mirrors the existing _pair_had pattern).

#### Iteration 4
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Converged** -- no new actionable findings.
- [NIT] test:1 -- file mode 0644 vs siblings' 0755 --> FIXED (417627eb).
- [NIT] release-freeze.sh:335 -- cosmetic restore message on an abort between backup and overwrite --> DEFERRED: that window is essentially nil (adjacent lines, no command between) and the restored bytes are correct.
- [NIT] test:31 -- no explicit had_ptr=0 + backup-present arm --> DEFERRED: same first branch (bak_root short-circuits restore over remove); coverage adequate.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | test-site-restore-1548.sh:45 | ARM4 tautological | FIXED | 14c80d90 |
| 2 | 1 | CONVENTION | .claude/plans/ | no plan file | DEFERRED | hand-made worktree, small fix |
| 3 | 1 | NIT | release.sh:322 | "step 5" imprecise | FIXED | 14c80d90 |
| 4 | 1 | NIT | release.sh (manifest) | .precut untracked noise | RESOLVED | by #5 (BUILD_ROOT) |
| 5 | 2 | WARNING | release.sh:553 | .precut in shared site checkout could be staged into a deploy | FIXED | 8e099dc6 |
| 6 | 2 | NIT | release-freeze.sh:277 | usage line stale | FIXED | 8e099dc6 |
| 7 | 2 | NIT | test:22 | .sha256 unasserted | FIXED | 8e099dc6 |
| 8 | 3 | WARNING | release.sh:324 | stale comment (rejected design) | FIXED | 72869081 |
| 9 | 3 | NIT | release.sh:326 | _ptr_had from tarball alone | DEFERRED | dup of #7 concern; mirrors _pair_had |
| 10 | 4 | NIT | test:1 | file mode 0644 | FIXED | 417627eb |
| 11 | 4 | NIT | release-freeze.sh:335 | cosmetic message | DEFERRED | window ~nil, bytes correct |
| 12 | 4 | NIT | test:31 | no had_ptr=0+backup arm | DEFERRED | bak_root short-circuits; adequate |

### NITs (non-blocking, across all iterations)
- Two cosmetic/coverage NITs deferred at iteration 4 (see #11, #12) -- both benign.

### Strengths (across all iterations)
- Trap ordering airtight: release_site_restore reads the BUILD_ROOT backup before the same trap's `rm -rf`, auto-cleaning with no separate cleanup.
- Backup-before-overwrite under `set -euo pipefail`: a failing backup cp aborts the cut before the served pointer is touched, so an asymmetric served/aborted pair cannot arise.
- No regression to the 3-arg callers: `${4:-1}` / `${5:-}` make the pointer loop a no-op for them; test-release-detached.sh stays green.
- The new test's three arms each have a control that can genuinely return the dangerous answer, and it is wired into `test:shell`.
