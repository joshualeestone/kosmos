---
pre_challenge: true
method: challenge-loop
branch: autopost-promote-2159
diff_hash: 92afdb0dc80d803b9f380b984c05303e994c14789dafdeb921456a7793e4ad6a
validation: passed
subdir_audit: passed
timestamp: 2026-09-06T10:46:41Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4 found zero new BLOCKER/WARNING/CONVENTION)
**Total findings:** 3 BLOCKERs/WARNINGs (all WARNINGs, all fixed), 0 CONVENTIONs (one false finding), several NITs
**Fixed:** 3 WARNINGs (+ 1 NIT) | **Deferred:** 4 NITs | **Asked:** 0

The change (#2159): wire the release-notes social-post hook into `deploy-site.sh`'s `--promote`
go-live path, so a staging->prod promote (the launch flow, how 0.6.37 reached prod) announces the
release on the deploy that actually serves it -- exactly as a direct prod CUT already does
(release.sh's #2159 hook). Safe by construction: post-release-notes.sh is DRY-RUN unless a deliberate
multi-gate is enabled (--publish AND KOSMOS_SOCIAL_AUTOPOST=1 AND live @installkosmos creds), so a
promote previews the notes and a bad note can never auto-publish.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 1 WARNING, 2 NITs, 1 CONVENTION
- [WARNING] deploy-site.sh:343 -- a --promote can be a ROLLBACK; the hook would announce a rolled-back
  older version as "is out" --> FIXED (bf88191b): gate the announce on the promoted version ($sj)
  being strictly NEWER than the pre-deploy live version ($LJ) via `sort -V`; skip rollback + same.
- [NIT] deploy-site.sh:347 -- hook not pre-verified in the precondition block --> DEFERRED: matches
  release.sh, best-effort `|| echo` handles a missing hook without failing the deploy.
- [NIT] deploy-site.sh:350 -- else branch cosmetics --> DEFERRED: addressed incidentally by the rewrite.
- [CONVENTION] .claude/plans/ -- no plan file --> LATER REVEALED FALSE (iteration 3): the plan is
  release-notes-social-2159.md, named for the feature, not the branch; the search pattern missed it.

#### Iteration 2
**New findings:** 1 WARNING, 1 NIT (+ dedups of iter-1 NIT/CONVENTION)
- [WARNING] deploy-site.sh:354-360 -- when the prior version ($LJ) is unreadable, control fell through
  to ANNOUNCE, so a rollback could be announced --> FIXED (a7fe1124): SKIP on empty prior version
  (a rollback can't be told from a forward move without it; a missed announcement beats a wrong one).
- [NIT] post-release-notes.sh:4-5 -- stale header (said "called from promote-channel.sh"; the real
  promote-side LIVE post is now deploy-site.sh --promote) --> FIXED (a7fe1124): aligned to all three
  call sites (release.sh cut live, deploy-site --promote go-live live, promote-channel preview).

#### Iteration 3
**New findings:** 1 WARNING, 2 NITs; the iter-1 CONVENTION revealed FALSE
- [WARNING] test-deploy-site-promote.sh -- the safety-critical announce/skip branch had zero test
  coverage --> FIXED (0bf91928): two cases added to the (already test:shell-wired) promote harness --
  a FORWARD promote announces, a ROLLBACK promote skips. Red-capable: inverting the version compare
  (tail->head) fails BOTH cases (verified).
- [NIT] deploy-site.sh:365 -- cross-machine double-post (per-machine idempotency log) --> DEFERRED:
  pre-existing limitation acknowledged in the plan; all paths dry-run today.
- [NIT] deploy-site.sh:361 -- sort -V zero-pad variants sort distinct --> DEFERRED: never occurs under
  the X.Y.ZZ scheme; fails safe (treated as rollback -> skip).

#### Iteration 4
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Converged** -- three STRENGTHs (gate correct in every case, set -eu safe, the rollback test is a
genuine branch-discriminating mirror scenario with a positive+negative control), and one unreachable
fail-safe NIT (leading-zero variance, "no change needed").
- [NIT] deploy-site.sh:361 -- theoretical sort -V-equal-but-string-unequal (leading zeros) --> DEFERRED:
  unreachable with real X.Y.ZZ Kosmos versions; noted for completeness only.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | deploy-site.sh:343 | rollback announces older version | FIXED | bf88191b |
| 2 | 1 | NIT | deploy-site.sh:347 | hook not pre-verified | DEFERRED | matches release.sh, best-effort |
| 3 | 1 | CONVENTION | .claude/plans/ | no plan file | FALSE | plan exists (feature-named) |
| 4 | 2 | WARNING | deploy-site.sh:354 | empty prior version announces | FIXED | a7fe1124 |
| 5 | 2 | NIT | post-release-notes.sh:4 | stale header comment | FIXED | a7fe1124 |
| 6 | 3 | WARNING | test-deploy-site-promote.sh | no test coverage of the branch | FIXED | 0bf91928 |
| 7 | 3 | NIT | deploy-site.sh:365 | cross-machine double-post | DEFERRED | pre-existing, dry-run today |
| 8 | 3 | NIT | deploy-site.sh:361 | sort -V zero-pad | DEFERRED | unreachable, fails safe |

### NITs (non-blocking)
- deploy-site.sh:347 hook not pre-verified (iter 1) -- consistent with release.sh, best-effort.
- deploy-site.sh:365 cross-machine double-post (iter 3) -- per-machine idempotency, dry-run today.
- deploy-site.sh:361 sort -V leading-zero variance (iter 3, iter 4) -- unreachable, fails safe.

### Strengths (across iterations)
- Faithfully mirrors release.sh's #2159 hook (same env vars, best-effort guard, DRY-RUN reliance).
- Fires AFTER served-verify success -- announces only a confirmed-live deploy, never an aborted one.
- Every ambiguous case (empty/same/rollback/unknown-prior) fails toward "do not post" -- correct for
  an irreversible public action.
- set -eu safe; the actual hook call keeps the best-effort `|| echo` so it can never fail the promote.
- The new rollback test is a genuine mirror scenario with a positive (forward) and negative (rollback)
  control, proven red-capable.
