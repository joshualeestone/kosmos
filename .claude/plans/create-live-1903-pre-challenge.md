---
pre_challenge: true
method: challenge-loop
branch: create-live-1903
diff_hash: a6fe21accff9ad3da460615adc98ecc974e07869dbdca7e0241196ab2233d670
validation: passed
subdir_audit: passed
timestamp: 2026-09-02T21:30:45Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2 returned zero BLOCKER/WARNING/CONVENTION)
**Total findings:** 2 WARNINGs, 3 NITs (0 BLOCKERs, 0 CONVENTIONs)
**Fixed:** 2 WARNINGs + 2 NITs | **Noted:** 1 NIT (benign ordering, defensible) | **Asked:** 0

Validation: `node --test engine/*.test.js server.create-live-1903.test.js` = 1969 pass / 0 fail. Perturbation-verified: disabling the route gate reds the refuse test; disabling accountConnectable's NONE-check reds 3 engine arms. No regression: server.projects.test.js (122) + server.agent-import-1652 (6) pass (gate fail-open on their fake bins' UNKNOWN).

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
- [WARNING] server test — the "no launch file" assertion was vacuous under DRY_RUN (no plist written either way) --> FIXED: key on the birth log (createAgent records a birth for every create it reaches, even DRY_RUN); a refused create leaves no 'deadborn' birth, and the control asserts a 'liveborn' birth exists (recordBirth fires on a passed gate).
- [WARNING] engine/create.js OpenAI default arm — under a server codex-home override, the gate checks openaiaccounts' override-honoring default while the created agent's launchd job runs on the real ~/.codex (drift, false-refusal direction) --> FIXED: fail open on the OpenAI default when codexHomeOverridden(), mirroring createAgentInner's own guard.
- [NIT] bogus provider routed into the Claude arm --> FIXED: provider guard returns ok:true so createAgentInner answers REFUSE_PROVIDER.
- [NIT] the live subprocess ran before cheap deterministic refusals --> FIXED: the route runs the check only when nameProblem is clear.

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
- [NIT] the liveness gate runs before createAgentInner's memoryShared/isRemoved refusals, so a dead + not-shared/removed-name account shows the re-auth message first and the second refusal only on retry --> NOTED, benign and defensible (re-auth is a valid, correct first step for a genuinely dead account; mirroring those refusals at the route is more duplication than the extra round-trip is worth).
- 6 STRENGTHs: birth-log assertions non-vacuous with a working positive control; default-scope control discriminating and matches accounts.listLive; provider guard defers to REFUSE_PROVIDER; nameProblem guard cannot let a dead-account create slip through (route + inner agree on a bad name); OpenAI-default fail-open mirrors createAgentInner (over-conservative only in the fail-open direction, never a false refusal); no credential leak, no double-send, sync core contained (158 call sites untouched), #1315 asymmetry holds.

**Converged** — iteration 2 produced no actionable findings.

### Final Ledger

| # | Iter | Category | File | Description | Status |
|---|------|----------|------|-------------|--------|
| 1 | 1 | WARNING | server.create-live-1903.test.js | "no launch file" assertion vacuous under DRY_RUN | FIXED (birth-log check + control) |
| 2 | 1 | WARNING | engine/create.js | OpenAI-default override drift | FIXED (fail-open on codexHomeOverridden) |
| 3 | 1 | NIT | engine/create.js | bogus provider -> Claude arm | FIXED (provider guard) |
| 4 | 1 | NIT | server.js | live subprocess before cheap refusals | FIXED (nameProblem guard) |
| 5 | 2 | NIT | server.js | liveness before memoryShared/isRemoved | NOTED (benign, defensible) |

### Outstanding questions (ASKED)
None.

### Strengths
- The #1315 asymmetry, applied to create: refuse ONLY a positively-confirmed dead sign-in (checkLive NONE); accept connected, unconfirmable, unresolvable, and bogus-provider (createAgentInner owns those refusals). Getting this wrong would have refused agent creation whenever the check itself failed — strictly worse than the bug.
- No carcass: the check is read-only and before any write, so a refusal leaves no half-made agent (Ben's first failure was a half-made agent).
- Sync core preserved: createAgent/createAgentInner untouched (158 call sites); only an async route callback + one new exported function.
- No credential-value leak; scoping mirrors accounts.listLive (default unscoped, guarding the decoy ~/.claude/.claude.json).
