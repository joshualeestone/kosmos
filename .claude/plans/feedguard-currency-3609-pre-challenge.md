---
pre_challenge: true
method: challenge-loop
branch: feedguard-currency-3609
diff_hash: 15de42e85adb37e3a11c46c4a7851ab4c9fae4fc35c10da8a257cbfcdb31fca0
validation: passed
subdir_audit: passed
timestamp: 2026-09-24T18:17:41Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6 (Opus and Sonnet alternating)
**Converged:** Yes
**Total findings:** 5 WARNINGs, 1 CONVENTION, plus NITs; no BLOCKER in any pass
**Fixed:** 4 WARNINGs | **Deferred:** 1 CONVENTION (separate pattern) | **Asked (awaiting user):** 0

Every WARNING was a test gap in a fail-closed guard: a plausible wrong edit that the
suite would have let through. None was an equivalence error in the function itself;
passes 1, 3, 5 and 6 each searched for one independently (exhaustive small-alphabet
searches of 57M, 5.4M and 5.2M strings; fuzz of 1.5M and 2M; 20 and 22 mutations) and
found none.

### Validation

Full suite on HEAD 4310676c, hash 15de42e8: 8553 pass, 0 fail (validation log clean,
2026-09-24T18:17:41Z). DEVELOPER_DIR set to CommandLineTools. Perturbation arms, each confirmed applied:
old regex wrapped as the fn (linear test red, 1395 ms); fraction arm removed; whitespace
skip reduced to ASCII space; 'euro' dropped; 'US$' added; whitespace walk capped at 50;
fraction walk capped at 20; scan cut to the first word; float generator restored. Each
turns at least one test red; unperturbed, 64 of 64 pass.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING (low), 0 CONVENTIONs, 4 NITs
**Self-generated:** 0
- [WARNING, low] 200 ms Date.now() bound on a loaded machine --> accepted: about 100x headroom measured
- [NIT] 'USDx' timing input never produced a word hit --> fixed (8049fddc)
- [NIT] seeded() split the #3608 comment from its test --> fixed (8049fddc)
- [NIT] no Unicode whitespace in generator or fixed cases --> fixed (8049fddc)
- [NIT] letters-only dependency undocumented --> fixed (8049fddc)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
- [WARNING] letters-only rule unenforced --> FIXED (122cbaa2): frozen word list, test asserts letters only
- [NIT] /\s/ literal in the loop --> fixed (122cbaa2)
- [NIT] hand-copied old regex --> kept deliberately, now also checked by the exact-list test (iteration 3)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 2 NITs
- [WARNING] dropping 'euro' from the list passed every test --> FIXED (b3aa7b7f): list pinned exactly, amount planted before every word
- [CONVENTION] the large-amount spelled pattern keeps its own word copy --> DEFERRED: changing a second pattern is out of scope; noted in the plan
- [NIT] new RegExp per call --> kept: a g regex carries lastIndex, per-call is the safe form

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING
- [WARNING] a cap on either backward walk passed every test --> FIXED (ce9f4de2): 64 KB-gap true positives and short fixed cases

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 2 NITs
- [WARNING] a scan that stops at the first currency word passed every test --> FIXED (4310676c): multi-word fixed cases, currency words in generator noise
- [NIT] large-amount word copy (dup of iteration 3 CONVENTION)
- [NIT] comment did not name the real dependency --> fixed (4310676c)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 0 NITs
**Converged** -- 22 mutations, 19 killed, 3 survivors all shown equivalent against the old regex (unreachable loop bound, reordered pure conjunction).

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/feedguard.test.js timing | BRANCH | wall-clock bound | ACCEPTED | ~100x headroom |
| 2 | 2 | WARNING | engine/feedguard.js words | BRANCH | letters-only unenforced | FIXED | 122cbaa2 |
| 3 | 3 | WARNING | engine/feedguard.test.js | BRANCH | dropped word undetected | FIXED | b3aa7b7f |
| 4 | 3 | CONVENTION | engine/feedguard.js large-amount | BRANCH | second word copy | DEFERRED | out of scope |
| 5 | 4 | WARNING | engine/feedguard.test.js | BRANCH | walk cap undetected | FIXED | ce9f4de2 |
| 6 | 5 | WARNING | engine/feedguard.test.js | BRANCH | first-word-only undetected | FIXED | 4310676c |

### Strengths (across all iterations)
- The function's correctness argument is written where it runs and survived every independent search
- Tests pin answer and time together, and every floor was checked for honest margins
- The shared generator's float-multiply cycle was found and fixed, and the #3608 test's inflated count corrected
