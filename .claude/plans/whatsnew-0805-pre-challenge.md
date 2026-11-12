---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0805
diff_hash: 2bd604b5ad432efad4133962bedeb41578a2a5f9c9626a7825151906e630e6d3
validation: passed
subdir_audit: passed
timestamp: 2026-11-12T09:55:07Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 1 (0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 6 NITs)
**Fixed:** 1 WARNING and 3 NITs | **Deferred:** 0 | **Asked (awaiting user):** 0

Initial validation (6.0) passed on 6f565e8c5c (hash 254f0e4e9e84, full run-tests). 6g passed on 12ae4ef416 (hash 2bd604b5ad43); 6j skipped on that clean entry.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above (ITER_COMMITS empty)
- [WARNING] release/whats-new-pool.json:1759 / web/whats-new.json:10 - "now reads as running" is true only once the agent's supervisor restarts on the new build; the Windows updater restarts only the board. --> FIXED (12ae4ef416): line now says "an agent restarted on this version", item carries restart: "agents" (checked in the generated Windows notes).
- [NIT] release/whats-new-pool.json:1783 - "still refused" implied the prefixed forms were refused before. --> FIXED (12ae4ef416): "now refused even when"; title changed to "Common prefixes no longer hide a stop command" (an interim "with any prefix" title was an overclaim and was replaced before commit).
- [NIT] release/whats-new-pool.json:1795 - the token-guard line read as immediate; #8438 says at the next refresh. --> FIXED (12ae4ef416).
- [NIT] .claude/plans/whatsnew-0805.md:13 - name #8431's card. --> FIXED (12ae4ef416): "#8431 (card #8430)".

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings (confirmed resolved):** 1 (the restart flag on the Windows running line, confirmed accurate)
- [NIT] release/whats-new-pool.json - title "Restarting agents on Windows read as running" reads oddly.
- [NIT] release/whats-new-pool.json - the suggested-answer line omits the project card (under-claim, safe).
- [NIT] .claude/plans/whatsnew-0805.md - Windows lines are retired by hand, not by `shown`; not restated for the new Windows item.
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | release/whats-new-pool.json:1759 | BRANCH | Windows running line needs an agent restart | FIXED | 12ae4ef416 |

### NITs (non-blocking, across all iterations)
- [NIT] kill-guard line "still refused" (iteration 1) - fixed
- [NIT] token-guard line timing (iteration 1) - fixed
- [NIT] plan table card number for #8431 (iteration 1) - fixed
- [NIT] Windows running title wording (iteration 2)
- [NIT] suggested-answer line omits the project card (iteration 2)
- [NIT] hand retirement of Windows lines not restated (iteration 2)

### Strengths (across all iterations)
- The committed web/whats-new.json is byte-identical to a fresh `build 0.8.05 --offline` from the pool; prod-check agrees prod is 0.8.02 (iterations 1 and 2).
- Every PR merged since the 0.8.04 freeze f4032d90e7 is in the plan table with a pool entry or a reason for none (iteration 1).
- Platform tags match the code: #8428 Mac-only, #8435 and #8438 Windows-only, the suggested answer untagged (iterations 1 and 2).
- The rerank is written down with before and after counts, the weakest premise and what would reverse it (iteration 1).
