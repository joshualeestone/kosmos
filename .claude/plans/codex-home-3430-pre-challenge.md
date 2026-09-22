---
pre_challenge: true
method: challenge-loop
branch: codex-home-3430
diff_hash: e8b8102577b222ebd6a4d84cf3792b2e2a53402f2a8660d63338e0830c04ba9c
validation: passed
subdir_audit: passed
timestamp: 2026-09-22T22:37:10Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** Yes (iteration 1 produced zero actionable findings)
**Total findings:** 2 (0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs)
**Fixed:** 0 | **Deferred:** 2 | **Asked (awaiting user):** 0

Note on model witness (kosmos#2032): this fix is a tight mirror of the merged #3417
CLAUDE_CONFIG_DIR seam, which converged over two reviewer models (sonnet + opus).
This card's own loop converged on a single opus pass with zero actionable findings;
per the loop rule, a zero-actionable iteration is convergence and a confirming
second pass is not run. The underlying pattern therefore already carries multi-model
review from #3417.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 (ITER_COMMITS empty; single commit under review)
**Converged** — no new actionable findings.
- [NIT] tools/test-supervisor-codexhome-leak-3430.sh:83 — the claude-arm discriminating control reuses the same new-session.args file and relies on the second run overwriting the first. Fails SAFE (a stale codex-args file would make the control report bad, never a false pass). Deferred: fail-safe; a fresh STUB_DIR for the second run would isolate it, but the current form cannot pass for the wrong reason.
- [NIT] tools/test-supervisor-codexhome-leak-3430.sh:34 — the stub tmux `show-environment` prints an unset var to stdout/exit-0 rather than stderr/non-zero. No correctness impact (the supervisor's `2>/dev/null || true` + the `CODEX_HOME=?*` case handle both identically) and the set-var path under test is faithful. Deferred: same fidelity gap as the sibling test-supervisor-ccd-leak-3417.sh; kept consistent with it.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | NIT | tools/test-supervisor-codexhome-leak-3430.sh:83 | BRANCH | control reuses args file (fail-safe) | DEFERRED | fail-safe; cannot false-pass |
| 2 | 1 | NIT | tools/test-supervisor-codexhome-leak-3430.sh:34 | BRANCH | stub show-environment fidelity | DEFERRED | matches sibling test; no correctness impact |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking)
- control reuses new-session.args file (iteration 1) — fail-safe, deferred.
- stub show-environment fidelity (iteration 1) — matches the sibling ccd-leak test, deferred.

### Strengths (across all iterations)
- Faithful mirror of the merged #3417 CLAUDE_CONFIG_DIR seam (same case-parse rejecting the removed-line/unset forms, same empty-stays-unset caution, same pin-for-determinism rationale).
- EFFECTIVE_CODEX_HOME assigned unconditionally before any branch, so it is defined on both arms before the dismiss shim references it (set -u clean).
- No double-push: the block only resolves the server-global fallback when the forwarding loop forwarded nothing; all four cases resolve the pane read and the dismiss write to ONE home.
- Correctly codex-arm scoped (never pins CODEX_HOME on a claude pane); the test's discriminating control proves it.
- Contract preserved (no new positional arg, no reorder); CI wiring complete (added to test:shell after its sibling; a tools/test-*.sh needs only that one index).
- Test is non-vacuous (pre-run control + asserts the exact -e CODEX_HOME launch arg + confirms the codex arm); non-vacuity also measured against origin/main (the pane is not pinned without the fix).
