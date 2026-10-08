---
pre_challenge: true
method: challenge-loop
branch: pluginboard-5309
diff_hash: 9ea7436ef54e7b223776d5a9b9571d07f98f40a916e25c6bd3ad53f19f9ff642
validation: passed
subdir_audit: passed
timestamp: 2026-10-08T08:04:47Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (this re-loop; reviewer models sonnet → opus). Regenerated after a peer-review fix —
see note below.
**Converged:** Yes
**Total findings (this re-loop):** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs (the CONVENTION-ish provenance
note folded in), 4 NITs, + strengths
**Fixed:** 3 WARNINGs + the provenance + 2 doc items | **Deferred:** 2 doc NITs | **Asked:** 0

Card #5309 part 2, slice 1 (engine-only): the per-agent plugin REACH signal. `engine/pluginreach.js`
computes, per agent, whether the plugins the person installed in their own provider app reach that
agent (Claude default = reaches/same folder; non-default = separate-account-folder; Codex = isolated by
design #4592; other runners = not-applicable; unreadable/relative/non-string/`..`-bearing = unknown).
Pure `reachFrom` + injectable `reachForAgent`. Names no file inside a provider folder — the reach
CONDITION only, not specific plugins; the board UI is slice 2.

**Why this proof was regenerated.** An earlier run of this loop converged 3 passes (opus/sonnet/opus) and
a full green at head `4ff0e383d`, and PR #5561 opened. Peer reviewer Sonya then found a real
false-`reaches:true` the loop had deferred as a nit (the default-launch branch returned reaches:true
before the person-home absoluteness check). That is a CODE change, so this loop was re-run from scratch
on the fixed code. The prior proof is superseded by this one.

### Per-Iteration Breakdown

#### Iteration 1 (re-loop)
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs (plus the Sonya fix at 9a8db01e0 that
seeded this re-loop)
**Self-generated:** 0 (findings on the pre-loop module base + the Sonya-fix commit; Origin BRANCH)
- [WARNING] engine/pluginreach.js — `reachForAgent` coerced a non-string truthy `configDir` to null, which `reachFrom` read as a default launch -> a false reaches:true disagreeing with reachFrom's own UNKNOWN. --> FIXED (8eb1b4da2): pass configDir through unchanged; reachFrom judges its type.
- [WARNING] engine/pluginreach.js — `reachFrom(null)` threw (the `= {}` default only covers undefined); "never throws" was false. --> FIXED (8eb1b4da2): a null/non-object arg -> UNKNOWN.
- [WARNING] engine/pluginreach.js — path.resolve is lexical; a crafted `..`+symlink dir could compare equal to the person home -> false reaches:true. --> FIXED (8eb1b4da2): reject any `..` segment in either dir -> UNKNOWN.
- [CONVENTION/NIT] review provenance ("Sonya", "m4778") in source/test comments. --> FIXED (8eb1b4da2): state the invariant only.
- Regression tests added for all three (non-string configDir, null arg, `..` dir).

#### Iteration 2 (re-loop)
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above acted on
- [NIT] engine/pluginreach.js header — the summary clause "a non-string ... agent dir ... yields UNKNOWN" is imprecise since a *null* dir (non-string) is the default-launch reaches:true case; reviewer confirms it reads consistently in good faith (the param doc clarifies null = default launch) and is NOT a safety issue. --> DEFERRED (non-blocking; anti-churn: not re-editing the header each round).
- [NIT] plan — says "18 tests", actual is 20 (19 pluginreach test blocks + the reachable sweep). --> DEFERRED (stale count; correct value recorded here).
**Converged** — zero NEW actionable findings; the dangerous `reaches:true` direction defended at every traced path (confirmed by 5 strengths).

### Final Ledger (this re-loop)

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/pluginreach.js | BRANCH | resolver coerced non-string configDir -> false default-launch reaches:true | FIXED | 8eb1b4da2 (pass-through) |
| 2 | 1 | WARNING | engine/pluginreach.js | BRANCH | reachFrom(null) threw; "never throws" false | FIXED | 8eb1b4da2 (null/non-object -> UNKNOWN) |
| 3 | 1 | WARNING | engine/pluginreach.js | BRANCH | lexical path.resolve + `..`/symlink -> false reaches:true | FIXED | 8eb1b4da2 (reject `..`) |
| 4 | 1 | CONVENTION | engine/pluginreach.js + test | BRANCH | review provenance in source comments | FIXED | 8eb1b4da2 (invariant only) |
| 5 | 2 | NIT | engine/pluginreach.js header | SELF | "non-string agent dir" clause imprecise (null=default); good-faith, not a safety issue | DEFERRED | non-blocking; anti-churn |
| 6 | 2 | NIT | .claude/plans/...md | BRANCH | plan "18 tests", actual 20 | DEFERRED | correct value in this proof |

(The predecessor run's findings — the #265 reachable orphan EXCUSED at 71f670583, the iter-2 normalisation/
EFFECTIVE_CCD/relative-path fixes at 82cf27b9f, and Sonya's default-launch-guard fix at 9a8db01e0 — are
all in the branch history and remain fixed; this ledger lists the re-loop's own passes.)

### Outstanding questions (ASKED, still unresolved)
- None.

### NITs (non-blocking)
- [NIT] pluginreach.js header summary clause imprecise re a null agent dir (good-faith; param doc clarifies). (iter-2)
- [NIT] plan "18 tests" stale; actual 20 (19 pluginreach + the reachable sweep). (iter-2)

### Strengths (across the re-loop)
- The dangerous direction (false reaches:true) is defended at EVERY traced path: runner normalisation in one place (reachFrom); the person-home absoluteness/`..` guard sits ABOVE the default-launch return so a garbage home never yields reaches:true even on a default launch; relative/non-absolute/non-string/`..`-bearing dirs refuse to compare (UNKNOWN); path.resolve lexical compare over-reports a mismatch (safe direction).
- Resolver and pure core cannot judge the same input differently: reachForAgent passes configDir through unchanged and delegates all type/shape/runner interpretation to reachFrom; a dedicated non-string-configDir regression pins it. reachFrom is total (null/number/missing arg, non-string runner, non-string dir all return cleanly, never throw).
- Tests non-vacuous: a both-ways CONTROL prevents a blanket pass; every guard branch (codex, default, separate-account, relative, non-string, `..`, non-absolute person-home, null-arg, empty/non-string runner, not-applicable) and the resolver paths are covered.
- The single EXCUSED entry is accurate, instructs its own deletion when slice 2 adds the caller (so it cannot later mask a dead export), and does not over-excuse; the EFFECTIVE_CCD over-report is disclosed identically in the module header and the plan; scope matches the plan (no per-plugin naming, no UI); no em dashes, debug lines, or review-provenance in source.

### Validation
Full suite GREEN on the exact head 8eb1b4da2 (clean worktree, token unset, queued for a quiet slot per
Liu Kang m4763): validation-log `validation PASSED` (stack=typescript, hash 9ea7436ef54e), node 16650
tests / 16414 pass / 0 fail / 0 cancelled / 236 skipped; one transient shell-shard exit-3 retried and
passed. subdir audit passed. Local `node --test engine/pluginreach.test.js engine.reachable.test.js` = 20/20.
