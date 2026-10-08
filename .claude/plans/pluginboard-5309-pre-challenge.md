---
pre_challenge: true
method: challenge-loop
branch: pluginboard-5309
diff_hash: ad1145722bd981d0bac9b3549d2caecab8b128880ba062419485c8a60cd947db
validation: passed
subdir_audit: passed
timestamp: 2026-10-08T14:05:21Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (this re-loop; reviewer models sonnet → opus). Regenerated after a peer-review fix —
see note below.
**Converged:** Yes
**Total findings (this re-loop):** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT, + strengths
**Fixed:** 1 WARNING (+ a coupling comment) | **Deferred:** 1 NIT | **Asked:** 0

Card #5309 part 2, slice 1 (engine-only): the per-agent plugin REACH signal. `engine/pluginreach.js`
computes, per agent, whether the plugins the person installed in their own provider app reach that
agent (Claude default = reaches/same folder; non-default = separate-account-folder; Codex = isolated by
design #4592; other runners = not-applicable; unreadable/relative/non-string/`..`-bearing = unknown).
Pure `reachFrom` + injectable `reachForAgent`. Names no file inside a provider folder — the reach
CONDITION only, not specific plugins; the board UI is slice 2.

**Why this proof was regenerated.** A prior run of this loop converged and PR #5561 opened at head
`2f5b2bd04`. A further blind pass (sonnet) then found a real latent over-report: `reachForAgent` read
the DEFAULT world's job because it never threaded a `worldId`, so once slice 2 wires a NAMED-world
caller a cross-world read could yield a false `reaches:true`. That is a CODE change (threading the
world id), so this loop was re-run on the fixed code at head `6815c4533`. The prior proof is superseded
by this one.

### Per-Iteration Breakdown

#### Iteration 1 (re-loop)
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 (findings on the module base inherited from the prior converged head; Origin BRANCH)
- [WARNING] engine/pluginreach.js — `reachForAgent(agentName, deps)` called `create.readJob(agentName)`
  with no world id, so it read the DEFAULT world's same-named job. Jobs are world-keyed; once slice 2
  wires a live NAMED-world caller, a default-world job of the same name could be read instead of the
  agent's own, producing a false `reaches:true` (the dangerous direction) for a cross-world name. The
  prior loop had recorded this only as a documented slice-2 obligation; a latent bug a reviewer can name
  should be closed, not deferred. --> FIXED (6815c4533): threaded the world id —
  `reachForAgent(agentName, worldId, deps)` → `create.readJob(agentName, worldId)`; `deps` stays LAST so
  the test seam does not sit between the two real arguments. `worldId` is passed straight through
  (reachForAgent invents no world); `undefined` reads the default world, correct ONLY for the default,
  unnamed world, and the residual caller obligation (a named-world caller MUST pass its world id) is
  stated in the module header and the resolver doc comment.
- [NIT→coupling] engine/pluginreach.js — the resolver reads back `configDir` and `runner` from the job;
  if create.js renamed either field the resolver would silently coerce to a default-launch `reaches:true`.
  Verified by reading create.js that ALL THREE job arms emit exactly `{configDir, runner}` (mac
  readPlistJob, linux readUnitJob, the win32 spec). --> Added a field-name coupling comment pinning that
  invariant, and the injected-deps tests exercise those same names so a rename surfaces as a resolver
  test failure rather than a silent false reach. (A heavyweight real-plist contract test was judged
  disproportionate — the shape is pinned by measurement + the coupling comment + the deps tests.)
- Regression test added: `#5309 p2 resolver: worldId is threaded UNCHANGED to readJob (named-world
  scoping)` — an inline `create.readJob` spy captures the world id and asserts it is passed through
  verbatim (a named id, then `undefined`). Test count 22 → 23.

#### Iteration 2 (re-loop)
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 acted on
- [NIT] engine/pluginreach.js:83 — `reachFrom` treats `agentClaudeDir === ''` (as well as `null`) as a
  clean default launch returning `reaches:true`. A reviewer could prefer folding `''` → UNKNOWN. -->
  DEFERRED, and surfaced for slice 2: folding `''` → UNKNOWN depends on slice 2's unwritten env-reading
  contract (what an empty `CLAUDE_CONFIG_DIR` from the live pane will mean) and would risk regressing a
  real default launch to a false-negative today. The current `null`/`''` → default-launch behaviour is
  documented in the param doc and consistent; the reviewer rated it not worth blocking.
**Converged** — zero NEW actionable findings; the dangerous `reaches:true` direction defended at every
traced path (3 strengths below). Two reviewer models (sonnet iter-1, opus iter-2) witnessed the
convergence.

### Final Ledger (this re-loop)

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/pluginreach.js:122 | BRANCH | resolver read the default world's job (no worldId) -> latent cross-world false reaches:true for a named-world caller | FIXED | 6815c4533 (thread worldId → readJob) |
| 2 | 1 | NIT | engine/pluginreach.js:114 | BRANCH | configDir/runner field-name coupling to create.js could silently coerce to default-launch reaches:true on a rename | FIXED | 6815c4533 (coupling comment + deps tests pin it; verified all 3 arms) |
| 3 | 2 | NIT | engine/pluginreach.js:83 | SELF | reachFrom treats agentClaudeDir==='' as default-launch reaches:true | DEFERRED | surfaced for slice 2 (depends on its env contract; folding now risks a false-negative) |

(The predecessor runs' findings — the #265 reachable orphan EXCUSED, the normalisation/EFFECTIVE_CCD/
relative-path fixes, Sonya's default-launch-guard-order fix, the raw-home `..` collapse + win32-sep fix,
the falsy-runner / non-object-job / deps-require-escape / array-job fixes — are all in the branch history
and remain fixed; this ledger lists only this re-loop's own passes on the worldId-fixed head.)

### Outstanding questions (ASKED, still unresolved)
- None.

### NITs (non-blocking)
- [NIT] pluginreach.js:83 — `reachFrom` treats `''` agent dir as a default launch (same as `null`);
  folding to UNKNOWN is a slice-2 decision tied to its env-reading contract. (iter-2, DEFERRED)

### Strengths (across the re-loop)
- The dangerous direction (a false `reaches:true`) is defended at EVERY traced path: runner normalisation
  lives in one place (reachFrom); the person-home absoluteness/`..` guard sits ABOVE the default-launch
  return, so a garbage home never yields `reaches:true` even on a default launch; relative / non-absolute
  / non-string / `..`-bearing dirs refuse to compare (UNKNOWN); the `path.resolve` lexical compare
  over-reports a MISMATCH (the safe direction), never a spurious reach. The worldId fix closes the one
  remaining latent route a named-world caller could have taken to a false reach.
- Resolver and pure core cannot judge the same input differently: `reachForAgent` passes `configDir`
  through unchanged and delegates all type/shape/runner interpretation to `reachFrom`; the worldId is
  threaded verbatim and invents no world. A dedicated worldId-threading spy test and a non-string-configDir
  regression pin both couplings. `reachFrom` is total — null / number / missing arg, non-string runner,
  non-string dir all return cleanly, never throw.
- Tests non-vacuous: a both-ways CONTROL prevents a blanket pass; every guard branch (codex, default,
  separate-account, relative, non-string, `..`, non-absolute person-home, null-arg, empty/non-string
  runner, not-applicable) AND the resolver paths (including the new named-world scoping) are covered.
  Scope matches the plan (no per-plugin naming, no UI); the EFFECTIVE_CCD over-report is disclosed
  identically in the module header and the plan; no em dashes, debug lines, or review-provenance in source.

### Validation
Full suite GREEN on the exact head `6815c4533` (clean worktree, token unset, queued for a quiet slot
behind the 0.7.28 release per Liu Kang m4763): validation-log `validation PASSED` (stack=typescript,
hash `ad1145722bd9`), node 16653 tests / 16417 pass / 0 fail / 0 cancelled / 236 skipped; the
`shell-shard 1/1: FAILED (exit 3)` and `zzz-pete-not-a-ref` lines are test-internal fixtures (the shard
runner's own failure-handling test and the `#1025 CONTROL: unresolvable ref` negative control), not real
failures. subdir audit passed. Local `node --test engine/pluginreach.test.js engine.reachable.test.js` =
23/23, 0 fail.
