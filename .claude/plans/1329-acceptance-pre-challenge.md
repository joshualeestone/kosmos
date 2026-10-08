---
pre_challenge: true
method: challenge-loop
branch: 1329-acceptance
diff_hash: 891b31d9dd2d1957fec028fa66bd18a57fff096edec4ce298943763862b35d34
validation: passed
subdir_audit: passed
timestamp: 2026-09-07T18:21:24Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (both blind, independent)
**Converged:** Yes (iteration 2 produced no new BLOCKER/WARNING/CONVENTION after dedup)
**Total findings:** 5 (0 BLOCKERs, 1 WARNING, 1 CONVENTION, 3 NITs)
**Fixed:** 3 | **Deferred:** 1 | **Asked (awaiting user):** 0

Change under review: one new file, `engine/discover.acceptance-1329.test.js` - a test-only
acceptance guard for card #1329 (Josh's 2x2: {Claude, OpenAI} x {no agents, pre-existing agents}),
covering the pre-existing-agents column's classification for both providers against the seed corpus.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 2 NITs
- [WARNING] discover.acceptance-1329.test.js Part E - "both providers" claim was a Claude-shape
  lookalike: the codex fixture was a loose .md parsed identically to the Claude fixture, with no
  OpenAI/Codex code path exercised. --> FIXED (commit e884755f): rewritten to drive foundCodex
  (AGENTS.md named by a codex rollout) so the row carries runner='codex', a genuine provider signal.
- [CONVENTION] .claude/plans/ - no plan file for this branch. --> DEFERRED: card #1329 is
  verification/acceptance-test work assigned directly by Splinter; no feature plan file was created.
- [NIT] Part C perturbation comment overclaimed what the arm proves (the .gemini dotdir skip, not
  the explicit-roots gate). --> FIXED (commit e884755f): comment scoped to the exact guarantee.
- [NIT] Part D per-test AGENT_WORKFORCE_DATA swap was inert (store paths resolve at require time).
  --> FIXED (commit e884755f): removed the inert DATA swap, kept the live CONFIG_ROOT swap.

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Duplicates of prior findings:** 1 (the no-plan-file CONVENTION, already deferred)
**Converged** - no new actionable findings.
- [NIT] Part C perturbation portability: the gemini-merge gate reads three env vars
  (AGENT_WORKFORCE_GEMINI_HOME / GEMINI_CLI_HOME / AGENT_WORKFORCE_HOME); the helper managed only
  the first, so an ambient GEMINI_CLI_HOME on a CI box could produce a spurious red (fail-safe, never
  a hidden green). --> FIXED (commit 3fcdc910): withGeminiHome now clears the other two, and a new
  withNoGeminiHome clears all three for the perturbation arm - deterministic regardless of ambient env.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | discover.acceptance-1329.test.js (Part E) | provider claim was a Claude-shape lookalike, no OpenAI path | FIXED | e884755f (foundCodex, runner=codex) |
| 2 | 1 | CONVENTION | .claude/plans/ | no plan file for this branch | DEFERRED | card-driven acceptance-test work, no feature plan |
| 3 | 1 | NIT | Part C comment | perturbation comment overclaimed the gate | FIXED | e884755f |
| 4 | 1 | NIT | Part D | inert AGENT_WORKFORCE_DATA swap | FIXED | e884755f |
| 5 | 2 | NIT | Part C | perturbation cleared only 1 of 3 gemini-home vars | FIXED | 3fcdc910 |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- All three NITs raised were fixed (see the ledger); none deferred.

### Strengths (across all iterations, both blind agents concurring)
- Assertions are non-vacuous and red-capable, with explicit positive/anti-vacuity arms (the negative
  control carries a folder-mate proving the folder was read; importable.length===9 is a real
  double-count guard; Part E was observed going red when the sandbox guard blocked foundCodex).
- Every expected name verified against real parsing: bold names via identityFromText, pip/rust via
  the #8 headingName H1 fallback, Gemini via agentfile.geminiIdentity front-matter, runner=codex via
  foundCodex.
- Hermeticity is airtight and leak-free: all fixtures under one mkdtemp root, test.after cleanup,
  every env swap uses the prev===undefined?delete:restore idiom; os.homedir() and the operator's real
  ~/.claude / ~/.codex / ~/.gemini are never read.
- The header accurately separates classification (this file's lane) from location/reach (#2414) and
  documents the SCAN_SKIP neutral-folder footgun so the fixtures are actually reached.
