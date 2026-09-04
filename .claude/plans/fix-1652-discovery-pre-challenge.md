---
pre_challenge: true
method: challenge-loop
branch: fix-1652-discovery
diff_hash: 5c686b3627222a7ca942b577464dfceb53b0395556289b6909dbc87179e9a1c9
validation: passed
subdir_audit: passed
timestamp: 2026-09-04T17:25:47Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (6.0 baseline + 3 fresh blind passes; the last found zero actionable findings)
**Converged:** Yes
**Total findings:** 2 WARNINGs, 6 NITs (0 BLOCKERs, 0 CONVENTIONs)
**Fixed:** 2 WARNINGs + 4 NITs | **Deferred:** 1 NIT | **Asked:** 0

PR1 of 2 for kosmos#1652 (reopened): the discovery engine finds loose importable agent files.
The UI surfacing + a path-based import route are the stated PR2.

### Per-Iteration Breakdown

#### Iteration 1 (6.0 baseline)
Full suite + subdir audit clean on the branch as committed. No findings.

#### Iteration 2 (fresh blind pass)
**New findings:** 1 WARNING, 1 NIT
- [WARNING] engine/discover.js — sandbox-refusal return and /api/scan-agents catch-fallback omitted importable/bounded.importable while a comment claimed "same bounded shape"; PR2's UI would read undefined --> FIXED (f6613a52): both returns carry importable:[] + bounded.importable:false; new test pins the refusal shape.
- [NIT] engine/discover.js — MAX_MD_PER_DIR comment overstated "first N reach the agent file" (it is arbitrary readdir order) --> FIXED (f6613a52): reworded.

#### Iteration 3 (fresh blind pass)
**New findings:** 1 WARNING, 3 NITs
- [WARNING] engine/discover.import-1652.test.js — only MAX_IMPORTABLE was tested; MAX_MD_PER_DIR / MAX_MD_READS and the "read short sets bounded.importable" honesty claim were unexercised --> FIXED (64a9057c): added a maxMdReads test opt + tests for the per-dir cap and the read budget, both asserting bounded.importable.
- [NIT] engine/discover.js — hitImportable not set when the shared dir/count caps stop the walk --> FIXED (64a9057c): hitCount||hitDirs folded into hitImportable.
- [NIT] server.js — catch-fallback carried importable:[] but omitted bounded --> FIXED (64a9057c): fully-shaped bounded added.
- [NIT] plan.md — named /api/found-agents instead of /api/scan-agents and claimed "no route change" --> FIXED (64a9057c): corrected.

#### Iteration 4 (fresh blind pass)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
- [NIT] engine/discover.import-1652.test.js — refusal test asserted only absence, relying implicitly on another test's file for a positive control --> FIXED (9a18f8aa): explicit positive control (a real agent file beside the note) added.
- [NIT] engine/discover.js — per-dir cap counts reads after dedup, so many symlinks-to-one-target do unbounded realpathSync before the cap --> DEFERRED: theoretical (not a real DoS), the identical exposure the connect descend loop already has, bounded by dir entry count + the read/importable caps.
**Converged** — no new BLOCKER/WARNING/CONVENTION.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 2 | WARNING | engine/discover.js:788 | refusal/route returns omit importable shape | FIXED | f6613a52 |
| 2 | 2 | NIT | engine/discover.js (SCAN) | MAX_MD_PER_DIR comment overstated | FIXED | f6613a52 |
| 3 | 3 | WARNING | engine/discover.import-1652.test.js | only MAX_IMPORTABLE tested | FIXED | 64a9057c |
| 4 | 3 | NIT | engine/discover.js | hitImportable misses outer caps | FIXED | 64a9057c |
| 5 | 3 | NIT | server.js:4334 | catch-fallback omits bounded | FIXED | 64a9057c |
| 6 | 3 | NIT | .claude/plans/...-plan.md | wrong route name | FIXED | 64a9057c |
| 7 | 4 | NIT | engine/discover.import-1652.test.js:72 | refusal test lacks positive control | FIXED | 9a18f8aa |
| 8 | 4 | NIT | engine/discover.js:938 | realpathSync before per-dir cap (symlink dup) | DEFERRED | theoretical; same as connect loop; bounded by other caps |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking)
- engine/discover.js:938 — realpathSync-before-cap on duplicate symlinks (deferred, iteration 4).

### Strengths (across iterations)
- Return-shape consistency airtight across all three paths (normal / sandbox-refusal / route catch), pinned by a test.
- Content gate byte-identical to the connect scan (no drift); INTRODUCES has no /g so .test() is not stateful across the higher call volume.
- Symlink/path-escape safety: loose files reuse readClaudeHead (lstat regular-file, byte-bounded), realpath dedup, importOnly reached only as explicit roots with SCAN_SKIP still blocking deep descent; connect never handed a loose file's parent.
- All three caps honest and each exercised by a test that can fail; outer dir/count caps folded into hitImportable so a PR2 importable-only consumer cannot under-report.
- Connect candidates provably unchanged (only the !cur.importOnly guard added); 27 discover tests + fixtures regression suite green.
