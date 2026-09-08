---
pre_challenge: true
method: challenge-loop
branch: installer-exit-2503
diff_hash: 2858cb18e10cbf795a05d280fa4ba933723a1a90191e075f0979c8de15186d8f
validation: passed
subdir_audit: passed
timestamp: 2026-09-08T21:53:00Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (2 pre-merge review passes + 1 post-merge-resolution review)
**Converged:** Yes
**Total findings:** 4 (0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs)
**Fixed:** 1 | **Deferred:** 3 (all pre-existing / out of scope) | **Asked:** 0

kosmos#2503: the spawned installer shell exits with its trailing `if`, not with
`curl | sh`, so a FINISHED installer (success OR failure) makes the child exit 0 and the
real code is only in the status file. wireChild's `if (code !== 0)` was therefore dead for
every ordinary installer failure: the single-flight flag stayed stranded-true and
/api/update answered `already:true` to every retry. Fix: read the real code from the status
file for THIS attempt (matched by startedAt via the existing readStatusRaw), falling back
to the child's own code only when no matching status was written.

🔀 MERGE NOTE: after review converged, origin/main had landed #988 (PR #2504), which
modified the SAME exit listener (an `updating.announce(0)` clear placed OUTSIDE the failure
branch) and left a comment saying it did NOT fix the masking, "filed as kosmos#2503". I
merged origin/main (not rebased, to keep the proof-regen flow) and resolved the conflict by
keeping #988's announce-clear, applying the #2503 realCode fix, and REPLACING #988's
now-stale "does not fix / filed as #2503" comment with one that describes the block as
revived (the same stale-comment class this fleet keeps paying for). A dedicated blind pass
reviewed the merge result.

Reviewer models: sonnet (iter 1), opus (iter 2), opus (iter 3, merge resolution).

### Per-Iteration Breakdown

#### Iteration 1 (pre-merge)
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs
- [WARNING] engine.installer-exit-2503.test.js -- mkdtempSync temp dirs never removed. --> FIXED (a029abb8): test.after recursive rmSync + ROOTS tracker.
- [WARNING] engine/update.js -- pre-existing residual: installer fails but shell cannot write status -> read as success. --> DEFERRED: pre-existing, out of scope, undecidable without a new signal; documented in the code.
- 2 STRENGTHs: fix correct/minimal, no race; test reproduces the masked shape, non-vacuous, wired.

#### Iteration 2 (pre-merge)
**Reviewer model:** opus
**New findings:** 0 blocking, 1 NIT (plan-doc line numbers drift; not applied -- historical snapshot).
**Converged** (pre-merge). 5 STRENGTHs confirming correctness on all axes, no race, test discriminates even against a broken version of the fix.

#### Iteration 3 (post-merge-resolution)
**Reviewer model:** opus
**New findings:** 0 BLOCKERs/WARNINGs/CONVENTIONs, 1 NIT
**Converged.** 5 STRENGTHs: the integration composes correctly (announce-clear then failure block, right order, owner-guarded / single-flight); NO stale dead-block comment survives (the #988 "does not fix" comment fully removed, replaced with an accurate past-tense one); no #988 functionality dropped (announce-clear, after-listeners announce, startPolling boot-clear + tick guard, the require all present); test 4/4 non-vacuous; updating.announce fails soft so it cannot break the listener; no em dash.
- [NIT] engine/update.js -- `installStarted = false` is not owner-guarded. DEFERRED: PRE-EXISTING (identical in origin/main's block, not introduced by this merge), bounded by single-flight.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine.installer-exit-2503.test.js | BRANCH | mkdtempSync temp dirs not cleaned up | FIXED | a029abb8 |
| 2 | 1 | WARNING | engine/update.js | BRANCH | pre-existing: installer-fails-but-cannot-write-status reads as success | DEFERRED | pre-existing, out of scope, documented |
| 3 | 3 | NIT | engine/update.js | BRANCH | installStarted=false not owner-guarded | DEFERRED | pre-existing (identical on main), bounded by single-flight |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking)
- [NIT] .claude/plans/installer-exit-2503.md -- plan-doc line numbers drift (iteration 2); left as a historical snapshot.
- [NIT] engine/update.js -- installStarted=false not owner-guarded (iteration 3); pre-existing, deferred.

### Strengths (across all iterations)
- Fix correct and minimal; reads the real installer code from the status file matched by startedAt; falls back to the child code only when no matching status exists.
- No status-write/exit race: printf completes and the file is whole before the trailing `if` and the exit event.
- Merge integration composes correctly with #988's announce-clear; no #988 functionality dropped; no stale dead-block comment survives.
- Test reproduces the exact masked production shape, is non-vacuous (arm 1 fails against the reverted fix), discriminates against a broken version of the fix, and is wired into the suite glob under the #1934 count assertion.
- No em dash in any changed file.
