---
pre_challenge: true
method: challenge-loop
branch: grok-observed-3391
diff_hash: 0cd70adb8a173da947e51836963868a2d7fc00e27acbb3d1dd2ad6b412fe8917
validation: passed
subdir_audit: passed
timestamp: 2026-09-24T06:45:09Z
iterations: 2
models: [opus, sonnet]
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (both model-varied iterations returned zero BLOCKER/WARNING/CONVENTION)
**Total findings:** 0 actionable (0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs) + 4 NITs
**Fixed:** 2 NITs (plan prose) | **Deferred:** 1 NIT (mirror consistency) | **Non-code:** 1 NIT (this proof file) | **Asked:** 0

Observed account-status badge for the XAI/Grok provider: a faithful structural mirror of the
merged #2413 (OpenAI/codex) and #3296 (Gemini/google) observability slices, one provider over.
Backend-only, no web/ change. Reviewer models rotated opus (iter1) / sonnet (iter2); both
independently cleared injectivity, freshness, cross-provider isolation, and the default-account
boundary, and both found zero actionable findings - the only NITs were plan-prose precision (fixed)
and one deliberately-deferred test redundancy inherited verbatim from the merged gemini precedent.

### Validation

Full suite (tools/run-tests.sh, DEVELOPER_DIR=/Library/Developer/CommandLineTools workaround):
8479 tests, 8331 pass, 0 fail, 148 skipped, RC=0 (6j run b6od1uo06). An earlier full run showed a
single failure in server.supervisor-refresh.test.js (ENOTEMPTY on temp-dir teardown); confirmed
HOST CONTENTION, not this change - the run's own footer flagged a live board sharing the Mac at
load 6.85, and the file passes 4/4 in isolation (RC=0). It touches no file in this diff. All 9 new
#3391 grok tests pass.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 (reviewed the committed BRANCH diff)
- [NIT] .claude/plans/grok-observed-3391.md (weakest premise) - "never a false green" understates the mtime false-fresh direction: grok contextUsedAt = signals.json mtime, weaker than codex/gemini content timestamps; the once-per-turn write is the false-fresh backstop, NOT the freshness gate (which closes only STALE). --> FIXED (06910bee: rewrote the weakest-premise section to state both directions and the true load-bearing premise)
- [NIT] .claude/plans/grok-observed-3391.md:38 / server.js overlay - "no default grok row" is imprecise; a default row DOES appear when the default dir holds a key. Scope-safety holds via accountForAgent returning null for a configDir-null agent, not via row absence. --> FIXED (06910bee: rewrote the scope-boundary paragraph to the null-return mechanism)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
- [STRENGTH] Independently cleared, under both static reading AND execution: provider injectivity (PROVIDER.XAI space-free, not a prefix of the others; unrecognized providers cannot land), cross-provider leak (the new isGrokPane arm is mutually exclusive; the Claude arm guard extended to !isGrokPane), server.js join isolation (filters to provider === XAI before joining grokRows), the double freshness gate (write side + verdict read side), and the default-account boundary (dir-less accountForAgent returns null for a foreign runner -> dropped, no leak). No em dashes (all 5 spellings, zero hits). One source of truth for the grok completion signal.
- [NIT] .claude/plans/grok-observed-3391-pre-challenge.md - proof file not yet written at review time. Process-state note, not a code defect. --> RESOLVED (this file)
- [NIT] server.grok-badge-3391.test.js:110-114 - the ISOLATION test's first half (XAI ok does not touch the Claude row) is guaranteed by the accountForAgent join alone, so it is redundant with THE FIX test. --> DEFERRED: inherited verbatim from the merged #3296 gemini precedent (server.gemini-badge-3296.test.js); diverging from the sibling would violate the faithful-mirror / no-drift convention this codebase enforces. Reviewer explicitly declined to score it against this PR.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | NIT | plan (weakest premise) | BRANCH | "never a false green" understated mtime false-fresh | FIXED | 06910bee |
| 2 | 1 | NIT | plan:38 | BRANCH | "no default grok row" imprecise; real mechanism is accountForAgent null | FIXED | 06910bee |
| 3 | 2 | NIT | proof file | BRANCH | proof not yet written at review time | RESOLVED | this file |
| 4 | 2 | NIT | server.grok-badge-3391.test.js:110 | BRANCH | ISOLATION test first half redundant | DEFERRED | mirror consistency with merged #3296 |

**Convergence:** Two models, both zero BLOCKER/WARNING/CONVENTION. All NITs are plan-prose (fixed),
this proof file, or a deliberate 6e deferral. Zero NEW actionable findings after dedup: 6d CONVERGED.
