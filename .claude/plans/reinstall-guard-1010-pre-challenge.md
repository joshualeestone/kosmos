---
pre_challenge: true
method: challenge-loop
branch: reinstall-guard-1010
diff_hash: a42841516332ce2b7e665ea8008e5683925357f7188b7eacfa5682ea841dd886
validation: passed
subdir_audit: passed
timestamp: 2026-09-02T21:39:12Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2 returned zero BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 3 (0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs)
**Fixed:** 1 | **Deferred:** 0 | **Asked:** 0 | **Accepted (optional NITs):** 2

Sign-in-path change, so both iterations used a blind reviewer briefed to probe the
guard placement, security, consumer regressions, and test faithfulness.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
- [NIT] account-switch edge (same Mac, different account, same name -> keeps the
  original enrolment, the new code unused) is not surprising-proofed --> FIXED
  (417f1f2f): added a one-line in-code note that this is by design and forget()
  is the account-switch path.
- Reviewer independently verified: the only consumers (server.js:3108,
  web/index.html) read only `.ok`/`.because`, so the added `alreadySetUp`/`address`
  fields break nothing; guard placement, edge cases, security, and the test's
  mutation claim all confirmed.

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Converged** — no actionable findings.
- [NIT] the account-switch edge is documented but not exercised by a test arm --
  optional strengthening. ACCEPTED (documented in-code; forget() coverage exists
  elsewhere).
- [NIT] in the account-switch edge, remote.json's email is briefly inconsistent
  with the enrolled identity -- cosmetic (email is status text only, never
  identity). ACCEPTED (documented).
- Reviewer re-confirmed correctness/security/no-regression/test-quality and the
  sole caller (server.js:3108 reads only ok/because).

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | NIT | remote.js | account-switch edge not surprising-proofed | FIXED | 417f1f2f (in-code note) |
| 2 | 2 | NIT | remote.test.js | account-switch edge lacks a test arm | ACCEPTED | optional; behavior documented in-code |
| 3 | 2 | NIT | remote.js | remote.json email vs enrolled identity mismatch on account switch | ACCEPTED | cosmetic; email is status-only, forget() is the switch path |

### NITs (accepted with reasoning)
- A dedicated test arm for the account-switch edge would pin the documented
  behavior against drift; deferred as optional. The behavior is by design and
  the `forget()` account-switch remedy is covered elsewhere.
- `remote.json`'s email can momentarily disagree with the enrolled identity on an
  account switch; cosmetic, since email is used only for status text and the start
  step, never for identity.

### Strengths (across iterations)
- The guard is minimal and lands exactly where card item 1 points (`enrolled()`
  was never consulted before `setupComplete`), stopping the re-enrolment, identity-
  key churn, cert spend, and 409 for a same-name reinstall.
- Placement is correct: after the `settings.email` gate, before the code/name
  validation and the `setupRun` spawn (the only place that stops the re-enrolment).
- Security preserved: the guard fires only when the local identity key is present,
  so it grants nothing an attacker in that position lacks; device admission and the
  first-device-Allow argument are untouched.
- No consumer regression: the sole caller (server.js) reads only `.ok`/`.because`;
  the new fields are additive.
- The test is non-vacuous: it proves the guard fires (no second `setup complete`
  reaches the fake binary; `alreadySetUp`, correct address) AND a name-specific
  control (a rename still enrols and reaches the binary). Verified it REDS when the
  guard is removed (mutation).

### Deferred (documented in the plan/card, not this PR)
- The fuller fix keeps an already-enrolled Mac out of the setup UI in the first
  place (web/index.html Settings/setup flow) and wants a browser walk of the
  reinstall flow to verify; the UI can read the new `alreadySetUp` flag.
- Identity-persistence across a deliberate wipe stays NO (#1003); the coordinator
  copy is unchanged (no client sends `replace`). The card's other pieces (Baron's
  allow-list/cert fix, #1057's three-way wording) are already on main.
