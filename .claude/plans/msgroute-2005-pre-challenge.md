---
pre_challenge: true
method: challenge-loop
branch: msgroute-2005
diff_hash: af809d719cd18411f7781bbfba61331bc74614735dc06e50bbe0180c3c37a6df
validation: passed
subdir_audit: passed
timestamp: 2026-09-03T14:32:42Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3 returned zero new BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 3 (0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT) plus 1 synthetic baseline finding
**Fixed:** 3 | **Deferred:** 0 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1 (6.0 baseline validation)
**New findings:** 1 synthetic (worktree cleanliness)
- [BLOCKER] initial-validation: the helper recorded status=failed because the worktree was dirty (the plan file .claude/plans/msgroute-2005.md was untracked) --> FIXED (committed the plan file, commit b5089c60; the full test suite itself passed, worktree then clean).

#### Iteration 2 (first blind review)
**New findings:** 2 WARNINGs
- [WARNING] server.js:7764 (READ thread route) -- after presence case-folds, the downstream readThread still passed the raw mis-cased name to threadFile (which requires safeKey(key)===key), so GET /thread/Mara for card mara returned 200 with the resolved card AND a false "we cannot keep a conversation under this name" panel + empty history (was a clean 404 before). --> FIXED (commit 658f6bcc): readThread now uses member.sessionName; the inaccurate comment corrected.
- [WARNING] server.projects.test.js (coverage) -- the trust-hold change (7975) was only exercised with idle/stranger agents, so the mis-cased->trust-hold held case was unverified. --> FIXED (commit 658f6bcc): added a mis-cased send to an ours agent on the trust dialog asserting 409 + zero sends. Also found and fixed the SIBLING of W1 in the SEND route: appendMessage (8020) had the same raw-name bug (delivered but silently failed to record under a mis-cased name); added a round-trip test proving a mis-cased send RECORDS and a mis-cased read FINDS it.

#### Iteration 3 (second blind review)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Converged** -- no new actionable findings (five STRENGTHs confirming correctness, the delivery ours-gate, the file-key contract, and the unfilable-ours preservation).
- [NIT] server.projects.test.js -- no explicit arm for a mis-cased URL to a capitalized ours agent (the genuinely-unfilable-ours path). --> ADDRESSED as a final polish (commit 38ad209b): added an arm asserting a mis-cased send to Casey stays recorded:false and historyUnfilable:true, pinning that member.sessionName keeps the canonical name rather than a lowercased safeKey.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| S1 | 1 | BLOCKER | worktree | 6.0 validation dirty-worktree (untracked plan file) | FIXED | b5089c60 |
| 1 | 2 | WARNING | server.js:7820 | READ readThread used raw mis-cased name -> false unfilable panel | FIXED | 658f6bcc |
| 2 | 2 | WARNING | server.js:8020 | SEND appendMessage used raw mis-cased name -> delivers but does not record (sibling of #1) | FIXED | 658f6bcc |
| 3 | 2 | WARNING | server.projects.test.js | trust-hold held case unverified for a mis-cased name | FIXED | 658f6bcc |
| 4 | 3 | NIT | server.projects.test.js | no explicit capitalized-ours unfilable arm | FIXED | 38ad209b |

### NITs (non-blocking)
- [NIT] server.projects.test.js -- capitalized-ours unfilable arm (iteration 3) -- addressed in 38ad209b.

### Strengths (across all iterations)
- The three converted sites are correct and null-safe (member.sessionName dereferenced only after the if (!member) 404 guard); resolveCard case-folds only, never safeKey-strips, and prefers isNamedOurs -- exactly the #989 contract. (iter 1, iter 3)
- The raw-name/canonical-name split is right: deliver and viewport case-fold internally so they resolve the same card presence did, while appendMessage/readThread get the canonical key threadFile requires. (iter 3)
- The security boundary is preserved: the loosened presence gate is not a delivery gate -- addressable still refuses isNamedOurs !== true, so a case-folded non-ours pane passes presence but is refused at send with nothing typed. (iter 1, iter 3)
- The genuinely-unfilable-ours case is preserved by construction (a capitalized canonical name still throws BAD_THREAD). (iter 3)
- The 2348/2376 folder-write permits are correctly left exact-match (a case-fold on a write into a worker's on-disk folder is a real hole). (iter 1, iter 3)
- Tests are real, non-vacuous, and red-capable against origin/main. (iter 1, iter 3)
