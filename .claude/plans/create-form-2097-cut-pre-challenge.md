---
pre_challenge: true
method: challenge-loop
branch: create-form-2097-cut
diff_hash: a3ea9b4eff07c8f9ca66287bbe87eb04d15ec1c3a4a5a3acd0c443aeb6cdbc3b
validation: passed
subdir_audit: passed
timestamp: 2026-09-04T19:14:56Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 1 (0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs)
**Fixed:** 1 | **Deferred:** 0 | **Asked:** 0

Cut-blocker fix: #2097 hid the create-agent account row at <2 usable accounts but
left the wrapping `.mstep` drawing an orphan `::before` elbow and an extra rung of
indent. The CSS `:has(> #create-account-row[hidden])` rule collapses that mstep
(no elbow, no extra indent) so the one-account cascade is a clean provider→model.
The stale `render-create-form.js` (three assertions written for the retired
show-at-one layout, which blocked the 0.6.29 cut) is rewritten to assert #2097's
hide-at-one behavior and to guard both halves of the fix.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 0 NITs
- [WARNING] docs/browser-checks/render-create-form.js — The CSS fix has two halves
  (`content:none` drops the orphan elbow, `padding-left:0` drops the extra indent),
  but only the elbow half was guarded by an assertion. The hidden-branch cascade
  asserted only `model > prov + 10`, which passes at one rung (~28px) OR two (~56px),
  so a deleted `padding-left:0` would silently return the double indent while all 42
  checks stayed green. --> FIXED (commit 38d7756b): bounded the hidden-branch
  step-in to a single rung (`10 < delta < 45`; 45 sits between one rung ~28 and two
  ~56). Verified it reds on main's double-indent (delta 56, 38/42) and passes on the
  fix (delta 28, 42/42), both engines.

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | render-create-form.js (cascade) | padding-left half of the fix was unguarded; a return to double-indent would stay green | FIXED | 38d7756b |

### NITs (non-blocking, across all iterations)
- [NIT] render-create-form.js — the collapse-CSS guards (orphan elbow, single-rung
  cascade, one-arm) fire only in the HIDDEN (one-account) state; coverage of the fix
  therefore depends on the run environment rendering that state. The build box IS the
  one-account box (which is exactly where the old stale assertion failed), so the
  hidden path is genuinely exercised in the target run environment. (iteration 2)
- [NIT] render-create-form.js — two signals stand in for the same state (`acctShown`
  via `live()` for the cascade/arm assertions, `acctRowHidden` via `.hidden` for the
  elbow assertion). They are always complementary here, so the pairing cross-checks
  the two layers rather than causing drift; keep both. (iteration 2)

### Strengths (across all iterations)
- The two halves of the fix are guarded independently and non-redundantly (padding-left
  half by the single-rung cascade bound, content:none half by reading `::before`
  content off the exact mstep) — one arm per defect. (iteration 2)
- The CSS is tightly scoped via a direct-child `:has()` on a unique id, so it matches
  only the create form's account mstep and cannot touch the model mstep, provider frow,
  or detail-panel msteps; it is provider-agnostic (collapses cleanly for a one-account
  OpenAI board too). (iterations 1 and 2)
- The `acctShown === (acctCount >= 2)` invariant makes the account-rung assertion
  configuration-agnostic (correct in whichever account state the sandbox provides,
  including the 0-usable placeholder case). (iteration 2)
- The parallel OpenAI case (model row hidden via #2098) is NOT an equivalent orphan:
  `#create-model-why` stays visible in the model mstep and takes the hidden row's
  place, so the model elbow retains a target; no `:has(> #create-model-row[hidden])`
  guard is needed. (iteration 1)
