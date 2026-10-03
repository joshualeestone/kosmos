---
pre_challenge: true
method: challenge-loop
branch: revert-5063
diff_hash: 7efb7b195dbd89034b805d6aa30b7e1e4c260464c6a395746689063a8d7c4611
subdir_audit: passed
timestamp: 2026-10-03T00:32:28Z
converged: true
---

## Challenge loop: 1 blind round on a pure revert; converged

## [NIT] Round 1 (sonnet)
CONVERGED. Checked:
- Exactness: the revert touches the same 15 files as 124d24f9b (98 insertions, 669 deletions across them); against
  147ceba3 the branch is those 15 plus this plan. loginnotice-5018 plan files are removed as part of #5063's files.
- Dependents: the six commits in 124d24f9b..147ceba3 do not build on #5063 (no loginexpiry, claudeloginlive,
  login-expiry or loginnotice in their diffs); the revert applied without conflicts.
- Merge into current origin/main: merge-tree clean (tree 42a4c2c6); main's later commits overlap #5063 only in
  web/index.html, with no login/notice code, so main minus #5063 holds.
- Plan: the reason, the bisect evidence, the pinned-freeze intent and the weakest premise are stated accurately.
- No em dashes in added lines.

## Checks
render-gutter-return-4506 alone on Mortals: red 3/3 at 147ceba3 (the frozen 0.7.19 tree), green at 2da73952 (the
bump), red from 124d24f9b (#5063); at this revert head: 15 PASS / 0 FAIL, twice.
