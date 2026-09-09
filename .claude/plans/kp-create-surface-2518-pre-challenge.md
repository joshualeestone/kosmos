---
method: challenge-loop
branch: kp-create-surface-2518
timestamp: 2026-09-09T07:46:50Z
diff_hash: b06c5022f10de96fcd74ca27ddef6ddbba64ce4fb2adeab7890fd7f6479fe1c9
---

# Challenge-loop proof: kp-create-surface-2518 (KP create-journey surface annotations, #2518)

Two blind iterations, models varied (iter 1 Sonnet, iter 2 Opus). Converged at iteration 2: zero new
BLOCKER/WARNING/CONVENTION (the sole remaining WARNING is a pre-existing check-code follow-up, raised
and deferred in both passes, not a defect in this data-only change).

## Scope reviewed
Data-only: two `// Browser-check-surface:` annotations (line 1, no check logic changed) on the KP
create journey, plus a plan file. `git diff origin/main...HEAD` = 2 line-1 comments + the plan.

## The contract enforced
A declared token must be a DOM id the check ASSERTS on such that a rename/removal in web/index.html
makes the check FAIL -- and the assertion must FAIL-CLOSED (an assertion that defaults to pass on a
null lookup is false confidence, not coverage).

## Per-iteration ledger

#### Iteration 1 (Sonnet)
[BLOCKER] render-create-form.js declared `create-account-row`, but its only reader (L295)
`seen.acctRowHidden ? seen.acctElbowPainted === false : true` is fed by `acctRowHidden: id(...) ? ...
: null` -- a rename makes the lookup null, the ternary falls to its `true` default, and the check
passes UNCONDITIONALLY (masking the real orphan-elbow regression). FIXED: dropped the create-form
annotation. The fail-open ternary is a real CHECK bug -> documented as a follow-up (fix fail-closed,
then annotate); out of scope for a data-only batch. [CONVENTION/WARNING] render-createnav-2190 lacks
the sibling top-level `.catch` -> documented as a diagnostics follow-up.

#### Iteration 2 (Opus)
[BLOCKER] none. [CONVENTION] none. [NIT] none. Traced each remaining token's assertion and confirmed
it FAILS-CLOSED on a rename: made-head (throws on null + `/tester/.test(madeHead)` L101), create-msg
(throws on null + `/that name will not work/.test(createMsg)` L116), made-mark (missing -> INK n=0
fails the n>200 wait L133-137 + the green-tick L276 + the never-arm L321), cstep-made (false ->
wait-timeout FAIL + getComputedStyle throws, caught by the create-made .catch L331 -> exit 1). All
present whole-token in web/index.html (meta-guard green), distinctive, data-only, create-form stays
un-annotated, no dashes. [WARNING, non-blocking, deferred as in iter 1] createnav reds via an
unlabelled crash rather than a clean FAIL -- contract still holds; pre-existing check code.

### Final Ledger
- Final tokens (all asserted, fail-closed, present, distinctive):
  - render-createnav-2190.js: made-head create-msg
  - render-create-made.js: made-mark cstep-made
- render-create-form.js: DROPPED (fail-open check); create-form check-fix + createnav .catch are the two
  documented follow-ups (file a card).
- #2529 dead-annotation meta-guard green; gate + helper suites green; checks valid JS; zero em/en dashes.
- Bounded batch; remaining KP journey (sign-in, openai, plus/pay, badge/liveness) = clean follow-up batches.
