---
method: challenge-loop
branch: kp-journey-surface-2518
timestamp: 2026-09-09T07:08:52Z
diff_hash: 8f015c217acffffb7b9f467806d81f9238cbc5ea1bd382811e2916b2809afc53
---

# Challenge-loop proof: kp-journey-surface-2518 (KP connect+trust journey surface annotations, #2518)

Two blind iterations, models varied (iter 1 Sonnet, iter 2 Opus). Converged at iteration 2: zero new
BLOCKER/WARNING/CONVENTION.

## Scope reviewed
Data-only: four `// Browser-check-surface:` annotations (line 1, no check logic changed) on the KP
connect+trust journey browser-checks, plus a plan file. The gate lib, the helper, and every check's
logic are untouched (`git diff origin/main...HEAD` = 4 line-1 comments + the plan).

## The contract enforced
A declared token must be a DOM id/class the check ASSERTS on (so a rename/removal in web/index.html
actually reds the check) AND present whole-token in web/index.html. The #2529 dead-annotation meta-guard
checks PRESENCE; whether the check KEYS ON the token is the review's judgment.

## Per-iteration ledger

#### Iteration 1 (Sonnet)
[BLOCKER] render-firstrun-connect-fires.js declared `fr-claude-confirm`, which the check only uses in
setup (`box.hidden = true`) and never asserts -- a rename would NOT stale it (false confidence). FIXED:
swapped to `fr-pane-5`, asserted at `where.paneId === 'fr-pane-5'` and named in the docstring as the
surface this check reds on. [BLOCKER] render-firstrun-connect-box-2187.js declared only `fr-ctitle` (a
secondary, single-arm, reused class); its primary three-arm-asserted surface `#fr-sub` (the docstring's
"the fix") was undeclared. FIXED: added `fr-sub` primary, kept `fr-ctitle` secondary. [WARNING, scope]
render-claude-connect-choice-2433.js left the #2441 removal block (`.acct-disconnect[data-forget]`,
`.acct-remove[data-remove]`, asserted L183-194) uncovered. FIXED: added `acct-remove acct-disconnect`.

#### Iteration 2 (Opus)
[BLOCKER] none. [WARNING] none. [CONVENTION] none. Verified all 10 tokens genuinely asserted (cited the
check line for each), present whole-token in web/index.html (meta-guard green), distinctive with no
unrelated over-fire (acct-remove/acct-disconnect appear only in account-row CSS + paintAccounts, the
component the check drives), the diff data-only, no dashes. Confirmed the iter-1 `fr-claude-confirm ->
fr-pane-5` fix correct, and the two unchanged files' tokens (d-trust-restart/-msg, acct-claude-go/
-key-step) are asserted, not incidental. [NIT] the plan's token list lagged the shipped set -- FIXED
(synced the plan to the asserted tokens after this pass).

### Final Ledger
- Final tokens (all asserted, mutation-would-red, present, distinctive):
  - render-claude-connect-choice-2433.js: acct-claude-go acct-claude-key-step acct-remove acct-disconnect
  - render-trust-restart-0644.js: d-trust-restart d-trust-restart-msg
  - render-firstrun-connect-fires.js: fr-llm-connect fr-pane-5
  - render-firstrun-connect-box-2187.js: fr-sub fr-ctitle
- #2529 dead-annotation meta-guard green (no dead tokens); gate suite + helper suite green; checks still
  valid JS; zero em/en dashes on any added line.
- Bounded batch (connect+trust journey); the rest of the KP journey (sign-in board, create, openai
  connect, plus/pay, account badge/liveness) is a clean follow-up batch, same pattern.
