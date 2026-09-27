---
pre_challenge: true
method: challenge-loop
branch: codeph-4177
diff_hash: bd4fd3950d9920241a9e6dbdb566e2ce3f2bd04466fd32c08a3f05d2546da2ec
subdir_audit: passed
timestamp: 2026-09-27T12:14:06Z
converged: true
---

## Challenge loop: #4177 the Claude code field says Sign-in code

#### Iteration 1 (blind, sonnet)
No issues found. NO NEW FINDINGS.
- Checked: nothing else (page, browser checks, tests) is keyed on the old text or on acct-code's old aria-label.
- Checked: "Sign-in code" is the first-run field's own name (fr-conn-code); as acct-code has no visible label, the
  placeholder and aria-label are its accessible name, and it stays non-empty and descriptive.
- Checked: both new assertions fail against the old text (verified against main's page), so neither is vacuous.
- Checked: no em dash in any spelling.

## Evidence
- web.connect-tail-977: 4/4; control with main's page: the new assertion fails.
- Full suite on the branch: 10657 pass, 0 fail, exit 0.
- Found in the #727 walk (screenshot on #4177); #1720 gate passes by trailer (text only, unit-pinned); #2518 passes.
- Rebased onto main before this proof; the pinned test re-run after the rebase.
