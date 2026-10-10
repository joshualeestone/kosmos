---
pre_challenge: true
method: challenge-loop
branch: wn-0736
diff_hash: f78536daf5d85a53ae291a58217be9be7af2e71b42f88e33a8527af3d4b641ac
validation: passed (Mortals: node 18038 tests, 17796 pass, 0 fail; shell FAILS 0; browser-check gate overridden by the commit trailer, copy-only)
subdir_audit: passed
timestamp: 2026-10-10T02:30:07Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (opus, then sonnet)
**Converged:** Yes. Round 2 found no BLOCKER, WARNING or CONVENTION.
**Total findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Fixed:** 2 warnings, 2 nits | **Deferred:** 0 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown
- Round 1 (opus): 2 warnings. The plan claimed a complete list of PRs merged since the freeze, but it was incomplete
  and mixed issue numbers with PR numbers (#5720 was mislabelled). Fixed: every PR merged since 0.7.35 froze, by
  number, each with its reason. The needs-you item moved to rank 2.5, so the ranking is in the data and does not rest
  on a tie-break. The long-message line now says "how it starts".
- Round 2 (sonnet): no blocker or warning. The built file is byte-identical to `build 0.7.36` on the committed pool,
  and the cut's check accepts it for mac and windows. Every merged PR is accounted for.
- After convergence: the first Mortals run failed only on the browser-check gate (#1720), because web/whats-new.json
  changed without a trailer. An empty commit added the trailer this repo's What's New commits use; the diff hash is
  unchanged, the gate passes alone, and the full suite passed again.
- After #5731 merged (`build` now reads prod's pointer first), main's tool run online on this pool gives a
  byte-identical web/whats-new.json and leaves the pool unchanged (prod 0.7.35 = lastProd).

### Final Ledger
[WARNING] .claude/plans/wn-0736.md: the "not added" list was incomplete and mixed issue and PR numbers. FIXED.
[WARNING] .claude/plans/wn-0736.md: #5720 was mislabelled and #5721 was counted twice. FIXED.
[NIT] release/whats-new-pool.json: two items tied at rank 3, so the order rested on a tie-break. FIXED (2.5).
[NIT] release/whats-new-pool.json: the rank-17 line said "the first sentence". FIXED ("how it starts").
[NIT] release/whats-new-pool.json: "pane line" is a technical word. Not taken: rank 17, nowhere near the window.
[NIT] release/whats-new-pool.json: the needs-you line covers #5722's member rows only implicitly. Not taken: the line is a true superset.
[NIT] commit 679c8b4dd says "rank 3" while the pool says 2.5. Not taken: history, harmless.
[STRENGTH] web/whats-new.json is byte-identical to the pool tool's output, and the cut's check passes for both platforms (5 and 5).
[STRENGTH] The two new items match the merged PRs (#5698 and #5722; #5708), and both titles fit the window's limits.
[STRENGTH] The ranking call states its weakest premise and the one-number change that would reverse it.
