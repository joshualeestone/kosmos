---
pre_challenge: true
method: challenge-loop
branch: pwsignin-7357
diff_hash: 398f36eff50467440cd18dd76a5efd774df3acb19d43905bceb4716fae9ed963
validation: passed
subdir_audit: passed
timestamp: 2026-10-27T20:40:19Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes
**Total findings:** 21 (1 BLOCKER, 5 WARNINGs, 0 CONVENTIONs, 15 NITs)
**Fixed:** 1 BLOCKER, 5 WARNINGs, 8 NITs | **Deferred:** 0 | **Asked (awaiting user):** 0

Per-iteration checks: LogicTests run.sh, the iOS 16 simulator typecheck, server.ios-routes-6838.test.js. Final
validation (6j) passed on HEAD 71eddde811: node 24,390 pass, 0 fail, shell suite green; the closing helper call
skipped on the matching clean entry. The server half (kosmos-relay reviewdoor-7357, Ice Cream Kitty's) was read for
the contract in every round.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above (ITER_COMMITS was empty)
- [BLOCKER] ios/Kosmos/SignInView.swift:94 — a refused password went to the "Check your email" code step (no code was sent) --> FIXED (e2ceec0c66: reviewAnswer keeps a refusal on the password step)
- [WARNING] ios/Kosmos/SignInView.swift:70 — the link stayed after the door closed; pressing it gave a bare 404 --> FIXED (e2ceec0c66: a 404 is the door closed, back to email with a sentence)
- [WARNING] ios/Kosmos/SignInView.swift:270 — returning to the app did not ask about the door again --> FIXED (e2ceec0c66)
- [NIT] the two availability checks ran one after the other --> FIXED (e2ceec0c66, side by side)
- [NIT] the refusal fixture's wording --> FIXED (e2ceec0c66)
- [NIT] "Use a code instead" label --> FIXED (e2ceec0c66, "Sign in with a code")

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above (reviewAnswer, written in iteration 1, a code line, fixed normally)
- [WARNING] ios/Kosmos/SignInLogic.swift:34 — a 429 or 5xx with no sentence said the password was wrong --> FIXED (aa12688406)
- [NIT] sample list in the init comment --> FIXED (aa12688406)
- [NIT] a vacuous control --> FIXED (aa12688406)
- [NIT] focus chaining from the email field to the password field; link label vs plan

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above (the 429 sentence from iteration 2, a code line, fixed normally)
- [WARNING] ios/Kosmos/SignInLogic.swift:39 — the door's 429 carries the code limiter's sentence about codes, shown verbatim --> FIXED (ed4a60b043: a 429 gets this screen's own sentence)
- [WARNING] ios/LogicTests/main.swift:3652 — the 429 test used an empty body the server never sends --> FIXED (ed4a60b043, the server's real bodies)
- [NIT] exact sentence assertion, sample comment placement, closed door re-asked, plan wording --> FIXED (ed4a60b043)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] ios/Kosmos/SignInLogic.swift:36 — Kosmos+'s sentences showed in lowercase, and the test compared lowercase so could not see it --> FIXED (71eddde811: sentence() capitalises and closes; tests exact)
- [NIT] the password step does not focus a field on entry; repeated sample flag (FIXED, 71eddde811); model-level behaviour untested

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above
**Converged** — no new actionable findings.
- [NIT] email field Return does not move to the password; Sign in with a code stays enabled mid-request; a 5xx sentence ("Internal error.") and the company-sign-in sentence read oddly on this screen; the "server error" test uses empty bodies; an unexpected 2xx shape hands off to the web page

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | ios/Kosmos/SignInView.swift:94 | BRANCH | refused password landed on the code step | FIXED | e2ceec0c66 |
| 2 | 1 | WARNING | ios/Kosmos/SignInView.swift:70 | BRANCH | link stayed after the door closed | FIXED | e2ceec0c66 |
| 3 | 1 | WARNING | ios/Kosmos/SignInView.swift:270 | BRANCH | no re-ask on returning to the app | FIXED | e2ceec0c66 |
| 4 | 2 | WARNING | ios/Kosmos/SignInLogic.swift:34 | SELF | rate limit read as a wrong password | FIXED | aa12688406 |
| 5 | 3 | WARNING | ios/Kosmos/SignInLogic.swift:39 | SELF | code limiter's words on the password screen | FIXED | ed4a60b043 |
| 6 | 3 | WARNING | ios/LogicTests/main.swift:3652 | BRANCH | test body the server never sends | FIXED | ed4a60b043 |
| 7 | 4 | WARNING | ios/Kosmos/SignInLogic.swift:36 | BRANCH | lowercase sentences, test blind to it | FIXED | 71eddde811 |

### NITs (non-blocking, across all iterations)
- [NIT] focus chaining and focus on entry (iterations 2, 4, 5)
- [NIT] model-level behaviour untested (iteration 4)
- [NIT] Sign in with a code enabled mid-request (iteration 5; the code step has the same)
- [NIT] two server sentences read oddly here; empty-body test naming; unexpected 2xx goes to the web page (iteration 5)

### Strengths (across all iterations)
- Matches the server contract exactly: the link only on a clear 405, the body's three fields, no device id (iterations 1 to 5)
- The password is never logged or kept; cleared on success, on a closed door, on going back and on sign-out (iterations 1 to 5)
- The door check follows the passkey check's pattern; sample screens never ask the live server (iterations 1 to 5)
- A signed-in answer goes through the code sign-in's own Allow watch and hand-over (iterations 1 to 5)
