---
pre_challenge: true
method: challenge-loop
branch: openai401-2140
diff_hash: b66031dc97cf16a965342e95f8b2018d2fab945ce9af25f074e713b9523d388d
validation: passed
subdir_audit: passed
timestamp: 2026-09-05T06:28:19Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** Yes
**Total findings:** 0 actionable (0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs, 5 STRENGTHs)
**Fixed:** 0 | **Deferred:** 0 | **Asked (awaiting user):** 0

The one synthetic finding raised during validation (the browser-check gate on a
`web/` change) was addressed before the final gate: a `Browser-check:` trailer
was added explaining the change is a pure note-wording branch already covered by
the `web.openai-model-errors-2140.test.js` unit test. It is not a code finding
and is recorded here for completeness.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Converged** — a fresh blind reviewer found no actionable issues. It independently
verified: the 401 split faithfully mirrors the #1315 asymmetry already in
`checkLive()`/`addWithKeyLive()`; the body access is fully null-safe (bodyless
401, errorless body, and codeless error all fall through to the scope answer
without throwing); the only consumer of the engine `because` string is
`openaiNoModelsNote` (the two server validation callers key off
`runnableAllowlist(got)` and never parse the text, the display route passes it
through), so splitting one 401 string into two breaks no status-based decision;
no branch collision in `openaiNoModelsNote` (the new scope-401 string matches
none of the reconnect/403/generic patterns and vice versa); and both test halves
assert the meaningful outcomes with their opposite-arm controls retained.

- [NIT] web.openai-model-errors-2140.test.js:24 — the client test feeds a
  hand-copied literal of the engine's scope `because` string rather than importing
  the engine output; matches the established per-arm pattern in this file, not
  introduced here. Left as-is.
- [NIT] engine/openaiaccounts.test.js:166 — the scope path is exercised with
  `insufficient_permissions` and `body:null` but not `body:{error:{}}` (error
  present, code absent). The engine handles it identically (ternary yields null →
  scope) and the bodyless case covers the `code===null` outcome, so this is a
  completeness note only, not a behavior gap. Left as-is.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | (val) | (synthetic) | web/index.html | browser-check gate on a web/ change | RESOLVED | Browser-check: trailer added (commit e9821827, superseded by proof commit) |

No BLOCKER / WARNING / CONVENTION code findings were raised.

### NITs (non-blocking)
- [NIT] web.openai-model-errors-2140.test.js:24 — client test uses a copied literal of the engine string (iteration 1)
- [NIT] engine/openaiaccounts.test.js:166 — no `body:{error:{}}` case (handled identically) (iteration 1)

### Strengths
- The 401 split faithfully mirrors the #1315 asymmetry in `checkLive()`/`addWithKeyLive()` (iteration 1)
- Null-safe body access; bodyless/errorless/codeless 401s all fall through to the scope answer (iteration 1)
- No regression: only `openaiNoModelsNote` consumes the `because`; server callers use `runnableAllowlist` (iteration 1)
- No branch collision in `openaiNoModelsNote`; all matched substrings are mutually exclusive (iteration 1)
- Tests assert meaningful outcomes on both sides with opposite-arm controls retained (iteration 1)

### Validation
Full suite ran clean on a quiet box: `tests 4544 / pass 4544 / fail 0`, all shell
guard-test groups ALL PASS, `validation-log: validation PASSED`. Earlier local
runs tripped documented contention guards (a concurrent browser-checks run, an
install harness holding the gate port) and the one real browser-check gate, which
was satisfied by the trailer; none touched the changed files.
