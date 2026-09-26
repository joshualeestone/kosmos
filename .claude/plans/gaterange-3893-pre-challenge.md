---
pre_challenge: true
method: challenge-loop
branch: gaterange-3893
diff_hash: 00f72ea5aa14d8d57439806489d64ac555a4d1154e4b18a6bf585e7c8783e436
subdir_audit: passed
timestamp: 2026-09-26T05:59:26Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (the root cause was measured from GitHub's ref activity log plus a local rebuild of the CI merge; one blind reviewer; its BLOCKER fixed and re-measured).
**Converged:** Yes.

## Iteration 1 (the first fix, blind-reviewed)
- [BLOCKER] Anchoring diff, files and trailers on git's PLAIN merge-base pick reads MAIN's change and MAIN's trailer in the criss-cross when git picks the PR head, so a PR's own unexcused change passed silently. The reviewer reproduced it in both gates with the author's own fixtures. Fixed in iteration 2.
- [WARNING] Both positive controls ran with base = M1, so they had one merge base, not the criss-cross; one comment claimed otherwise. Fixed: criss-cross positive controls (base = M2) were added, and the comment was corrected.
- [STRENGTH] The ordinary single-merge-base case behaves identically, reasoned and measured by the reviewer: a branch that merged main in mid-life, a detached HEAD on main, and HEAD one commit ahead.
- [STRENGTH] The fail-soft paths hold in bash and zsh: a non-git directory and an unresolvable base both return 0 with the "could not diff" line.
- [STRENGTH] The fixtures reproduce #3893: on origin/main's libs, exactly the #3893 arm fails, in each gate.

## Iteration 2 (the anchor)
- [STRENGTH] `bcg_anchor_base`: with one merge base, use it; with several, use HEAD^1 when it is one of them, which is the tip CI's synthetic merge was built on, so HEAD^1..HEAD is exactly the PR's net change. Otherwise the gate says so and fails soft. Measured under zsh on the criss-cross: it anchors on HEAD^1, and the gate refuses the PR's own unexcused change.
- [STRENGTH] Each arm is red on the version it guards against. On the previous commit's libs, only the two criss-cross positive controls fail. On origin/main's libs, only the two #3893 arms fail. Both swaps also fail the copies-match check, correctly, since neither version has the helper. The swaps were restored from backups and verified with cmp.
- [WARNING] The helper is duplicated in both libs, because each is sourced alone, sometimes into zsh, and a shared source path is fragile there. A test asserts the two copies are identical, so they cannot drift silently.
- [WARNING] Not directly tested: a criss-cross where HEAD^1 is NOT among the merge bases (the fail-soft "cannot tell" branch). The branch is a stderr line plus return 1, and the caller's fail-soft path is the one already tested.
- [NIT] The fixtures pin commit dates so that git picks the PR head. A self-check asserts that pick, so the arms cannot go vacuous if git's heuristic changes.
- [CONVENTION] No em dashes. test-bc-surface-map, test-browser-check-surface-map and test-ci-gate-armed-2518 all pass.

## Weakest premise
- That CI's HEAD is always GitHub's synthetic merge (HEAD^1 = the base tip). On a push run to main, HEAD is main itself (one merge base, an empty range), which is unaffected. A workflow that checked out the PR head instead would have one merge base and also be unaffected.
