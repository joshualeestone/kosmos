---
pre_challenge: true
method: challenge-loop
branch: fed-prod-gate-3330
diff_hash: 9e98fc5e2700bb322b5c1e599d2cd3656d38b160d34fc431ccfb8211c2a44046
validation: passed
subdir_audit: passed
timestamp: 2026-09-20T00:06:15Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (reviewer models: opus, sonnet)
**Converged:** Yes
**Total findings:** 2 (0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs)
**Fixed:** 1 (a pre-review CSS-structure failure, below) | **Deferred:** 1 (a test-fidelity NIT) | **Asked:** 0

Change (#3330): gate the #3312 federation UI OFF for the prod channel, keep it on staging, so the 0.6.82 prod promote does not expose a not-ready feature (federation has no transport, no coordinator, no /api/federation/* routes). Mirrors the Windows platform gate: the status tick stamps `data-source-channel` on `<html>` from `/api/status`, and one CSS rule `html:not([data-source-channel="staging"]) .pj-mode,#pj-add-ext-person,#pj-add-ext-agent,#pj-invite-panel,#pj-join-mode { display:none !important }` hides the fed entry points by default and on prod, revealing them only on confirmed staging. Build + stage only; merging does not publish (the board/kosmosplus deploy is a separate step).

### Pre-review fix (6.0 validation)
The first 6.0 full-suite run FAILED one test: `server.test.js` "every CSS declaration in the page sits inside a selector". Root cause: that guard's declaration detector (`^[a-z][-a-z0-9]*\s*:`) treats a selector LINE beginning `html:not(...)` as a `property:` declaration when the multi-line selector list's continuation lines carry no brace at depth 0. It is a false positive on line-initial pseudo-class selectors, not a real orphaned declaration. Fixed by writing the rule on a SINGLE line (the file's own convention for multi-selector rules, e.g. `.tier-plus .tier-cta,.tier-teams .tier-cta,...{...}`): the line then carries the brace, so the guard's `!opens` check skips it. No test change, no CSS workaround. Full suite re-ran green (hash 9e98fc5e).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 acted on as SELF
- [NIT] render-fed-prod-gate-3330.js:91 — the check's ancestor-reveal forces `.pj-mode` to inline `display:block`, so the staging arm reads it as `block` rather than its natural `flex`; the arm still correctly confirms "visible" (not `none`). Explicitly "not a correctness problem." --> DEFERRED (test-fidelity only; the arm's assertion `!== 'none'` is what matters, and a real gate failure is still caught by the prod arm and the staging control).

Six strengths: gate mirrors the platform pattern and is fail-safe (unknown->hidden); `!important` overrides the panels' JS `hidden`-clearing so they cannot leak on prod; the five gated selectors are exactly right with `#pj-add-agent`/`#pj-create` correctly excluded; the setAttribute sits at the tick site not in paintBuildMark (build-marker lift test unaffected); publish-safe (only the CI allowlist gained one name); the browser-check is non-vacuous.

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** No issues found (0 of every category).
**Converged** — a second model witnessed the same clean result. Six strengths re-confirmed the scope, fail-safe default, setAttribute placement, non-vacuous check, complete wiring (all four browser-check meta-tests pass, the 117->119 / 85->87 emit-count bump matches the one added check), and no collateral damage (add-project / federation / build-marker / baked-version / server.test.js CSS-brace test all green; no deploy touched; no em dashes).

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 0 (6.0) | BLOCKER | web/index.html (CSS rule) | SELF | Multi-line `html:not()` selector tripped the CSS-structure guard's declaration detector | FIXED | Single-line rule (file convention), hash 9e98fc5e |
| 2 | 1 | NIT | render-fed-prod-gate-3330.js:91 | SELF | Reveal forces `.pj-mode` to block, staging arm reads block not flex | DEFERRED | Test-fidelity only; not a correctness problem (both reviewers) |

### Outstanding questions (ASKED)
None.

### Strengths
See per-iteration breakdown. Highlights: fail-safe by construction (no window where the not-ready UI flashes on prod), `!important` defeats the panels' own JS visibility toggles, the browser-check is non-vacuous with a load-bearing staging control, and nothing wires a deploy/publish.
