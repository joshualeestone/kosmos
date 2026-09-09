---
method: challenge-loop
branch: kp-openai-surface-2518
timestamp: 2026-09-09T08:16:38Z
diff_hash: e3c35d599b1eb611634da517d183e12329cb313938c5a896c6e75012054ef3d8
---

# Challenge-loop proof: kp-openai-surface-2518 (KP OpenAI-connect surface annotations, #2518)

Converged at iteration 1: a fresh blind pass (Sonnet) returned zero BLOCKER/WARNING/CONVENTION/NIT.
Data-only, and every token's fail-closed assertion was verified upfront before annotating (applying
the create batch's lesson), so the first blind pass had nothing to find.

## Scope reviewed
Data-only: two `// Browser-check-surface:` annotations (line 1, no check logic changed) on the KP
OpenAI-connect journey, plus a plan file. `git diff origin/main...HEAD` = 2 line-1 comments + the plan.

## The contract enforced
A declared token must be a DOM id the check ASSERTS on such that a rename/removal in web/index.html
makes the check FAIL, and the assertion must FAIL-CLOSED (a null lookup must fail, not default-pass).

## Iteration ledger

#### Iteration 1 (Sonnet)
[BLOCKER] none. [WARNING] none. [CONVENTION] none. [NIT] none. Traced each token's fail-closed path:
- `fr-openai-msg` (render-firstrun-openai-connectbox-2241.js): L65-66 `if (!host) return { error: ... }`
  -> L99 `if (r.error) { ...; process.exit(1); }`. A null lookup deterministically exits 1. Fail-closed.
- `fr-openai-go` / `fr-openai-key` (render-openai-key-step.js): L61 `if (!add || !key) return
  { incomplete: true }` -> L78-82 `check('reachable and complete', false, ...)` -> L109-111
  `process.exit(failed.length ? 1 : 0)`. A null on either exits 1. Fail-closed; matches the check's own
  L55-60 "gate only on what every build has" boundary.
Confirmed all three present whole-token in web/index.html (meta-guard green: fr-openai-go L8724,
fr-openai-key L8722, fr-openai-msg L8736), distinctive (all inside the #fr-openai-* block, no reuse),
data-only, no em/en dash.

### Final Ledger
- Final tokens (asserted, fail-closed, present, distinctive):
  - render-firstrun-openai-connectbox-2241.js: fr-openai-msg
  - render-openai-key-step.js: fr-openai-go fr-openai-key
- #2529 dead-annotation meta-guard green; gate + helper suites green; checks valid JS; zero em/en dashes.
- Bounded batch; remaining KP journey (plus/pay, badge/liveness, sign-in) = clean follow-up batches.
