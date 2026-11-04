---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0789
diff_hash: d02a5a4fea4244185b1ca565c51ec733113cbfaca5b20cad5ba6cf2dee5e2f4b
validation: passed (Mortals, full suite: 27042 tests, 0 failed, shell 4/4 shards green, entry status clean, on hash 044ef761ce97; only this plan file was added after it)
subdir_audit: passed
timestamp: 2026-11-04T18:58:55Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** Yes for this diff (no BLOCKERs). Its two WARNINGs were about the release entry on Mortals and the pool, neither in this diff.
**Total findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 0 NITs

### Per-Iteration Breakdown

#### Iteration 1
- [WARNING] the release entry's "its sender hears within 10 minutes" is wrong: 10 minutes is the earliest, it covers only an agent's message to another agent, and it left out the 2-hour drop --> FIXED in ~/.release-entry-0789.html on Mortals, not in this repo.
- [WARNING] docs/releasing.md asks for a pool item per user-visible change, and the pool has none since 0.7.84 --> FILED as #7963, claimed by Baron. It does not hold this cut: nothing false ships, and the window follows its rule.
- [STRENGTH] the diff is one line of web/whats-new.json (version 0.7.88 -> 0.7.89); release/whats-new-pool.json is unchanged.
- [STRENGTH] a rebuild leaves the tree byte-identical (sha of both files unchanged, cmp against HEAD 0); a control build for 0.7.90 differs at line 2, so the comparison can fail.
- [STRENGTH] whats-new-check 0.7.89 passes rc 0 for mac (5) and windows (3).
- [STRENGTH] whats-new-check 0.7.90 refuses with rc 3, so the check can say no.
- [STRENGTH] prod-check passes rc 0: the pool records prod 0.7.86, and prod serves 0.7.86.
- [STRENGTH] latest-win.json and latest-win-staging.json both read 0.7.86, so Windows has not used 0.7.89 by those pointers.
- [STRENGTH] the commit carries the Browser-check trailer for a data-only web/ change.
- [STRENGTH] the rest of the entry was read against commits: the Linux command, the held question, the iPhone thumbnail and launch screen. The iPhone items were checked from commit messages only.

### Weakest premise
- "Prod still 0.7.86" holds only until Josh promotes. If he names 0.7.88 before the cut freezes, the cut stops at step 1b-ii, and What's New is rebuilt with whats-new-pool.js build 0.7.89 under the hold.
