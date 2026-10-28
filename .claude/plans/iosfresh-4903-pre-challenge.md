---
pre_challenge: true
method: challenge-loop
branch: iosfresh-4903
diff_hash: b4f937c1e68ab279473aef6a161180858122d6b8862d5511fd10696c9c7ff46d
validation: passed
subdir_audit: passed
timestamp: 2026-10-28T06:48:46Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

`diff_hash` is `git diff origin/main...HEAD -- ':!.claude/plans/iosfresh-4903-pre-challenge.md' | shasum -a 256`.

**Validation of record:** full suite PASSED on 36b588d6b9, hash b4f937c1e68a (log val-iosfresh-4903-e.log). The iPhone sub-suites were fixed to compile SignInLogic.swift beside BoardLogic.swift (ios.board-parity-7084 caught five that no longer built).

**Convergence:** findings per round are in the commit messages ("review N:") and the plan. The final round's clean verdict was recorded as converged in the 10-27 handoffs, not in the plan.

### Per-Iteration Breakdown

#### Iteration 1
- [WARNING] a nonce miss posted anyway; a 409 run and a busy 503 or 429 did not end; the key was read more than once per connect. Fixed.
#### Iteration 2
- [WARNING] a session 429 was not kept a refusal; a nonce route refused with 401 or 405 was not read as none (token alone); the host was signed uncased. Fixed; tests pin post counts.
#### Iteration 3
- [WARNING] a 429 or a 403 paused/keep was not held as "not taking new sign-ins now" with its own sentence. Fixed.
#### Iteration 4
- [WARNING] a cloud machine refusing a phone that proved no key waited six fresh handoffs before saying sign in again; a 400 on the nonce route was not a miss. Fixed.
#### Iteration 5
- [WARNING] that refusal said the sign-in was too old; a web-page sign-in never keeps a key, so it now says sign in on this iPhone, in the app. Fixed.
#### Iteration 6
- No new findings (converged, per the 10-27 handoffs).

## Final ledger
No open BLOCKER or WARNING. Converged.
