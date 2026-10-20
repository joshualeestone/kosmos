---
pre_challenge: true
method: challenge-loop
branch: tlspin-6589
diff_hash: 049174d98bd597d580bca11ca547f34acf1f44676d480211a451036f757a267c
validation: passed
subdir_audit: passed
timestamp: 2026-10-20T09:48:30Z
iterations: 12
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 12 (alternating opus and sonnet)
**Converged:** Yes (iteration 12 found no BLOCKER, WARNING or CONVENTION; its two NITs were applied)
**Total findings:** about 60. Each round's findings and fixes are in that round's commit on this branch (`git log origin/main..HEAD`), which is the ledger of record.
**Fixed:** all BLOCKERs and WARNINGs | **Deferred:** stated in the plan | **Asked (awaiting user):** 0

The relay half (kosmos-relay#486, merged 2026-10-20 at 5af45040ad) has its own proof, 4 iterations.

### Per-Iteration Breakdown (each round's detail is its commit)

#### Iteration 1
**Reviewer model:** opus
- [WARNING] A board that answered badly was treated as ordinary checking. --> FIXED: required.
- [WARNING] Pins were not warmed. --> FIXED: warmed from the computer list.
- [WARNING] The selector was unpinned. --> FIXED: pinned with @objc.
- [WARNING] Parallel asks each ran the verb. --> FIXED: one run shared.

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] A forget during an ask could keep its answer. --> FIXED: generation counter.
- [WARNING] Warming re-asked a required computer constantly. --> FIXED: 60 s quiet window.
- [WARNING] The handler did not cancel if the delegate was gone. --> FIXED.

#### Iteration 3
**Reviewer model:** opus
- [BLOCKER] main.swift: SecTrustEvaluateAsyncWithError was called from main with another queue, which traps (measured, rc 133). Every switch would have crashed the app. --> FIXED: called from its own queue and driven by the self-test with a real certificate.
- [WARNING] A refusal did not say why. --> FIXED: mismatch versus could-not-check wording.

#### Iterations 4 to 9
**Reviewer model:** alternating
- [WARNING] The trust-failure cancel ran off main. --> FIXED (4)
- [WARNING] A trailing-dot host was not judged. --> FIXED (4)
- [WARNING] A trust evaluation that never started left the challenge hanging. --> FIXED (5)
- [WARNING] An address that is no computer of this account refused (a staging coordinator domain would refuse every computer). --> FIXED: none (6)
- [WARNING] An untrusted certificate's cancel read as superseded. --> FIXED (7)
- [WARNING] Two runs for one address could overlap after a forget. --> FIXED (8)
- [WARNING] An unknown answer was treated as ordinary. --> FIXED: never ordinary (8)
- [WARNING] The pin was skipped when ordinary trust failed. --> FIXED: the pin is judged first, then an allow hands back to WebKit (9)
- [WARNING] Header token only on the route. --> FIXED (7, 9)

#### Iteration 10
**Reviewer model:** sonnet
- [WARNING] The handler waited on its own trust evaluation. --> FIXED: judged at once; the leaf is read without an evaluation.
- [NIT] The port guard was pinned (205 self-test rows). --> FIXED

#### Iteration 11
**Reviewer model:** opus
- [BLOCKER] main.swift: SecTrustCopyCertificateChain evaluates the trust synchronously on the main thread (measured 3 to 9 s freezes per connection to a hostile server). --> FIXED: SecTrustGetCertificateAtIndex.
- [WARNING] The five-minute expiry was untested. --> FIXED: a mutant that never expires fails.
- [CONVENTION] Stale comments, test title and plan. --> FIXED

#### Iteration 12
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs (applied)
- The reviewer ran 8 engine mutants and 5 Swift mutants and all were caught (2 only by the self-test).
- The completion handler is called exactly once, on main, on every path.
**Converged.**

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 3 | BLOCKER | native-app/main.swift handler | BRANCH | async trust evaluation from main traps | FIXED | 254eb1b479, then dropped in 10 |
| 2 | 11 | BLOCKER | native-app/main.swift tlsLeafKeyHash | BRANCH | the chain call evaluates trust on main | FIXED | da56c0d990 |
| 3 | 6 | WARNING | engine/remote.js tlsPin | BRANCH | non-computer address refused | FIXED | 4c091deda3 |
| 4 | 8 | WARNING | native-app/main.swift tlsPinDecision | BRANCH | unknown answer was ordinary | FIXED | 6a24d5a9a2 |
| 5 | 9 | WARNING | native-app/main.swift handler | BRANCH | pin skipped on ordinary failure | FIXED | 7482cb8c71 |

### Outstanding questions (ASKED, still unresolved when the run ended)
- none

### NITs (non-blocking, across all iterations)
- Wording, plan counts and stated windows, applied as found (see the commits).

### Strengths (across all iterations)
- Every new system-API call is driven by the self-test with a real certificate (205 rows), so a contract violation fails the bundle build.
- The app half answers none until a connector with the tls-pin verb ships, so it is safe to merge before the next cut.
- Not run in the real app yet, as the plan says: the 0.7.61 cut is the first real-window check.
