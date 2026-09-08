---
pre_challenge: true
method: challenge-loop
branch: installer-exit-2503
diff_hash: f7652d6c65676d6c4488c396418fb921e8fe44c01886564cb4d23ed5b25b0827
validation: passed
subdir_audit: passed
timestamp: 2026-09-08T21:23:00Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2 returned zero new BLOCKER/WARNING/CONVENTION)
**Total findings:** 3 (0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT)
**Fixed:** 1 | **Deferred:** 1 | **Asked:** 0

kosmos#2503: the spawned installer shell exits with its trailing `if`, not with
`curl | sh`, so a FINISHED installer (success OR failure) makes the child exit 0 and the
real code is only in the status file. wireChild's `if (code !== 0)` was therefore dead for
every ordinary installer failure: the single-flight flag stayed stranded-true and
/api/update answered `already:true` to every retry. Fix: read the real code from the status
file for THIS attempt (matched by startedAt via the existing readStatusRaw), falling back
to the child's own code only when no matching status was written. New test reproduces the
MASKED shape (child exits 0 with a non-zero status file), the arm the card warns is the
only one that catches this, and is proven non-vacuous.

Reviewer models: sonnet (iter 1), opus (iter 2).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs
**Self-generated:** 0 (both WARNINGs are on this branch's new code, but pre-existing in kind)
- [WARNING] engine.installer-exit-2503.test.js -- four mkdtempSync temp dirs never removed; the repo pairs mkdtempSync with a recursive rmSync in test.after. --> FIXED (a029abb8): added test.after cleanup + a ROOTS tracker.
- [WARNING] engine/update.js -- pre-existing residual: if the installer FAILS but the shell cannot WRITE the status (full disk, read-only logs) while the trailing `if` still exits 0, a code-0 child with a stale/absent status is read as success. --> DEFERRED: pre-existing (the old code had the identical blind spot for every child-exits-0 case), out of scope for #2503, and undecidable without a separate expected-but-unwritten signal. Documented in the code comment rather than silently absorbed.
- 2 STRENGTHs: fix correct and minimal, no status-write/exit race; test reproduces the masked shape, non-vacuous, wired into the suite glob.

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs/WARNINGs/CONVENTIONs, 1 NIT
**Converged.** 5 STRENGTHs confirming: startedAt match holds by construction on the happy path; no race (printf completes before the trailing `if` before the exit event); the test discriminates even against a broken VERSION of the fix (a naive status.code fix fails arm 3); correct interaction with noteAttemptEnd's owner guard, the auto back-off, the error listener and the injected-runner wiring; conventions clean; the residual honestly documented.
- [NIT] .claude/plans/installer-exit-2503.md -- cites fixed line numbers that drift. Not applied: harmless in a historical plan doc (a snapshot of where the code stood), and chasing plan-doc line numbers is not worth a re-loop.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine.installer-exit-2503.test.js | BRANCH | mkdtempSync temp dirs not cleaned up | FIXED | a029abb8 |
| 2 | 1 | WARNING | engine/update.js | BRANCH | pre-existing: installer-fails-but-cannot-write-status reads as success | DEFERRED | pre-existing, out of scope, undecidable without a new signal; documented |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] .claude/plans/installer-exit-2503.md -- fixed line numbers drift (iteration 2); left as a historical snapshot.

### Strengths (across all iterations)
- Fix correct and minimal; reads the real installer code from the status file matched by startedAt; falls back to the child code only when no matching status exists (iterations 1, 2).
- No status-write/exit race: printf completes and the file is whole before the trailing `if` and the exit event (iterations 1, 2).
- Test reproduces the exact masked production shape (child exit 0, non-zero status file), is non-vacuous (arm 1 fails against the reverted fix, verified), discriminates against a broken version of the fix, and is wired into the suite glob under the #1934 count assertion (iterations 1, 2).
- Correct interaction with noteAttemptEnd's owner guard, the auto back-off (now reached), the error listener, and the injected-runner wiring; conventions clean, no em dash in any changed file (iteration 2).
