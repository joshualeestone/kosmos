---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: guardstrings-1701
diff_hash: PENDING
timestamp: 2026-08-31T21:45:00Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

Single-pass self review with perturbation. I set `explicit_override` myself and say so: I did not run the challenge-loop skill and did not spawn a review agent.

[STRENGTH] **The defect is demonstrated in my own merged code, not argued.** Rewording one phrase left the existing `doesNotMatch` control GREEN and reddened only the new guard. The control that should have caught the change did not.

[STRENGTH] **The guard carries its own negative control**: a phrase the product has never contained must not be found, so a positive result is not `includes` matching anything.

[STRENGTH] **Found by applying somebody else's live finding to myself.** Splinter reported the shape against a colleague's PR; I checked my own merged work rather than assuming it was fine, and it was not.

[WARNING] **This makes the two controls FAIL LOUDLY, not STRONG.** They still run in a scenario that cannot reach the appends they describe, so they assert the absence of warnings that could not have fired. I am not claiming otherwise and the PR says so.

[WARNING] **A source-text assertion is a weaker instrument than a behavioural one.** It couples the test to the product's wording, which is exactly the coupling that caused the problem. It is the right trade here only because the alternative is an assertion that silently means nothing.

[NIT] The guard names the three phrases explicitly rather than deriving them, so adding a fourth warning does not automatically get covered. Deriving them would need a shape the product does not currently expose.

[CONVENTION] No em dashes on any added line.

[CONVENTION] Worktree from `origin/main`, not bare `main`.

[WARNING, ADDED AFTER SPLINTER'S CORRECTION] **My remedy is the grep-shaped instrument he just warned about, and I want that on the record rather than discovered later.** Donnie's false alarm came from grepping SOURCE for a string the hook assembles at RUNTIME in jq. My guard does the same thing: `src.includes(phrase)` against `engine/create.js`.

**It is sound TODAY because these three phrases are literal string constants in `steps.push({ label: '...' })`, verified by reading them.** It would false-alarm the moment somebody builds one of those labels from a variable, and the control it protects might still be perfectly fine.

⇒ **The guard is verified by PERTURBATION, not by the grep** (rewording one phrase reddened it while the old control stayed green), which is the standard he asks for. But the instrument inside it is the weak kind, and if these labels ever become assembled this guard needs replacing rather than adjusting.

[STRENGTH, SAME EXCHANGE] **His refined criterion confirms my diagnosis independently:** the shape to look for is PASS-ON-ABSENCE with no paired firing arm, not the wording. That is exactly what `doesNotMatch` with no sibling `match` is, which is what I found in my own merged work.

### Final Ledger

Test-only change. Suite result recorded in the PR.
