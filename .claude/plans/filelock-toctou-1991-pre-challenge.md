---
pre_challenge: true
method: challenge-loop
branch: filelock-toctou-1991
diff_hash: bcae00a95e48aae6cc60bdc3c504e9885d582465914eb6b922d1817ad53462ea
validation: passed
subdir_audit: passed
timestamp: 2026-09-03T21:54:56Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 blind review passes (each a fresh, independent agent), plus a clean-baseline validation pass.
**Converged:** Yes - iteration 3 produced zero BLOCKER/WARNING/CONVENTION findings; its single NIT deduplicates to an already-documented residual.
**Total findings:** 1 WARNING, 4 NITs (0 BLOCKERs). All addressed or deferred with reasoning.
**Fixed:** 1 WARNING + 2 NITs (comment/doc accuracy) | **Deferred:** 2 NITs | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1 (blind concurrency review)
- **[WARNING]** filelock.js top comment heading read "VERIFIES IDENTITY BY INODE" after the mechanism was switched to mtime - a contradiction in a bug-prone primitive that could steer a maintainer toward the reused-inode hole the paragraph itself warns against. --> FIXED: heading now "BY MTIME".
- **[NIT]** residual-race wording "unchanged by this fix" understated that the restore opens a narrow new window. --> FIXED: reworded (comment + plan) to "strictly smaller than the guaranteed two-process double-entry it replaces".
- 5 STRENGTHs: mtime witness sound both directions; fail-safe null branches; test reproduces the dangerous sub-case and reds without the fix; meaningful control; chat.test.js breaker-claim verified accurate.

#### Iteration 2 (blind concurrency review)
- **[NIT]** restore-branch comments claimed a failed-restore `.stale` leftover is "collected by the staleness rule" - inaccurate (nothing enumerates `.stale` files; it persists inertly). --> FIXED: reworded comment + plan to "no reader matches it; not auto-collected".
- **[NIT]** an em dash in the new top-of-file bullet (Josh's no-em-dash rule; also inconsistent with the ASCII inline block). --> FIXED: removed; plan em dashes converted to hyphens; legacy em dashes elsewhere left untouched.
- 5 STRENGTHs: witness sound; null branches conservative; restore honest; test guards the restore specifically; control catches an always-restore fix.

#### Iteration 3 (blind concurrency review) - CONVERGED
- **[NIT]** the restore-failure orphaned `.stale` dir bypasses the match-branch's `rmSync` GC. --> DEFERRED: the reviewer states it is "honestly documented and requires a rare double-race to reach, so it is inert accumulation rather than a defect". Dedups to the already-documented residual (comment + plan already say `.stale` leftovers are inert and not auto-collected). No change needed.
- 5 STRENGTHs: witness correct over inode; residual race described precisely and honestly; null arms fail-conservative and the null-mtime arm fixes a latent pre-fix double-entry; test reproduces the specific dangerous interleave with a meaningful control; top-of-file comment internally consistent.
- Zero NEW actionable findings -> converged.

### Note on validation contention
The full test suite reported an intermittent red on `tools.release-gate.test.js` (8 stranded-bump/versions-entry git-state tests) across several runs under fleet load. That file is unrelated to this change (this diff touches only `engine/filelock.js` and its test); it passes 22/22 in isolation and on immediate re-run, and the final validation run recorded a clean PASS (hash bcae00a95e48). Confirmed contention, not a defect and not this change.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | filelock.js:22 | design heading said INODE, mechanism is mtime | FIXED | commit ddcb9ac4 |
| 2 | 1 | NIT | filelock.js:130 | residual "unchanged by this fix" understated | FIXED | commit ddcb9ac4 |
| 3 | 2 | NIT | filelock.js:130,138 | ".stale collected by staleness rule" inaccurate | FIXED | commit 12a0c905 |
| 4 | 2 | NIT | filelock.js:27 | em dash in new bullet | FIXED | commit 12a0c905 |
| 5 | 3 | NIT | filelock.js:139 | restore-failure .stale orphan bypasses GC | DEFERRED | Inert, honestly documented; dedups to residual |

### Strengths (representative, across iterations)
- The mtime witness is concurrency-sound in both directions: a re-acquired lock's mtime is ~now while a measured-stale lock's is >LOCK_STALE_MS old (a >10s gap no granularity bridges), so no false match; rename preserves mtime bit-exactly and nothing writes into a stale dir, so the no-race steal reads identical floats and never false-mismatches (the passing CONTROL confirms).
- The `measuredMtime == null` arm does not merely fail safe - it fixes a latent pre-fix double-entry on the stat-throws-then-rename-succeeds path.
- The #1991 test reproduces the dangerous sub-case the existing chat.test.js breaker never reached (rename SUCCEEDS on a live fresh lock, not the ENOENT empty-path case), guards the restore specifically (asserts the live holder's owner file survives), reds without the fix, and pairs with a control that catches an always-restore regression.
- Owner-token release semantics untouched; loop stays deadline-bounded (no wedge); no lock leak on the common path.
