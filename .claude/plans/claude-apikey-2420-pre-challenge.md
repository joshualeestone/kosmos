---
pre_challenge: true
method: challenge-loop
branch: claude-apikey-2420
diff_hash: 87366d8d6dea23bce17a9c620125ba1cc021ab665b8cdd15e4343a023ae9c7c8
validation: passed
subdir_audit: passed
timestamp: 2026-09-07T17:12:48Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes
**Total findings:** 1 BLOCKER, 3 WARNINGs, 1 CONVENTION, 8 NITs
**Fixed:** 8 | **Deferred:** 4 (1 CONVENTION + 3 NITs) | **Asked:** 0

Security-sensitive credential-handling feature (a pasted ANTHROPIC_API_KEY), so it got a focused, thorough loop. Each iteration surfaced real, diminishing-severity findings; iteration 4 found zero new BLOCKER/WARNING/CONVENTION.

### Per-Iteration Breakdown

#### Iteration 1 (6.0 initial validation + first blind pass)
**New findings:** 1 BLOCKER, 3 WARNINGs, 1 CONVENTION, 2 NITs
- [BLOCKER] server.js taken-label contamination - a label matching a signed-in SUBSCRIPTION account would drop a key file + apiKeyHelper into it, SILENTLY switching its billing to the pasted key --> FIXED (1775a1d3), perturbation-verified.
- [BLOCKER] initial-validation: engine.reachable.test.js #265 orphan guard (readKey/forgetKey/unwireApiKeyHelper reachable from nowhere) --> FIXED (1775a1d3): removed the genuinely-unused readKey; excused the forget pair.
- [WARNING] failed-store leaves a half-made account + orphaned key file --> FIXED (1775a1d3): catch now takes back the key file + apiKeyHelper.
- [WARNING] apiKeyHelperCommand only safe against spaces, not $/backtick/"/backslash in the home path --> FIXED (1775a1d3): shSingleQuote POSIX escaping, proven by an execSync metacharacter test.
- [CONVENTION] no plan file --> DEFERRED: the spec is GitHub issue #2420 (a slice; no /pplan warranted).
- [NIT] storeKey temp-file mode window --> FIXED (1775a1d3): unlink stale temp first.
- [NIT] missing coverage (injection label, non-object settings, collision) --> FIXED: tests added.

#### Iteration 2
**New findings:** 3 WARNINGs, 2 NITs (+ 1 CONVENTION duplicate)
- [WARNING] inverse billing-contamination via nextWorkDir - an api-key account (no oauthAccount) read as a FREE slot, so a subscription add could land on it and switch billing --> FIXED (29fd2213), perturbation-verified.
- [WARNING] the two EXCUSED reasons were false (forgetKey/unwireApiKeyHelper are called now by the catch) --> FIXED (29fd2213): removed both; added a truthful checkLive excuse.
- [WARNING] refused taken-label add merged hooks into an existing account (prepare ran before the guard) --> FIXED (29fd2213): guard now runs before prepare via the new side-effect-free accounts.dirForLabel.
- [NIT] keyProblem docstring described a non-existent sk-ant- check --> FIXED (29fd2213).
- [NIT] checkLive escaped #265 only by name-collision --> FIXED (29fd2213): explicit truthful excuse.

#### Iteration 3
**New findings:** 1 WARNING, 3 NITs
- [WARNING] storeKey's .tmp (raw key) survives a failed write, and forgetKey removed only the final file --> FIXED (ffbe2933), perturbation-verified: forgetKey now removes the .tmp too.
- [NIT] validateLive (network) ran before the taken-label guard --> FIXED (ffbe2933): guard now runs first (matches openai order; no wasted round-trip on a doomed add).
- [NIT] nextWorkDir require inside the loop --> FIXED (ffbe2933): hoisted.
- [NIT] nextWorkDir fail-open reasoning not documented --> FIXED (ffbe2933): comment states why failing open is safe.

#### Iteration 4
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs (new), 3 NITs
**Converged** - no new actionable findings. The CONVENTION (no plan file) is a duplicate of the deferred entry; the 3 NITs are 2 duplicates of already-deferred items + 1 new nit, none blocking. Multiple STRENGTHs confirmed both billing-contamination directions closed, credential containment correct, no load-order cycle.

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | BLOCKER | server.js | taken-label billing-switch | FIXED | 1775a1d3 |
| 2 | 1 | BLOCKER | engine.reachable.test.js | #265 orphan exports | FIXED | 1775a1d3 |
| 3 | 1 | WARNING | server.js | failed-store leaves litter | FIXED | 1775a1d3 |
| 4 | 1 | WARNING | claudeaccounts.js | apiKeyHelper shell-quoting | FIXED | 1775a1d3 |
| 5 | 1 | CONVENTION | .claude/plans/ | no plan file | DEFERRED | spec is #2420 |
| 6 | 2 | WARNING | accounts.js | nextWorkDir inverse contamination | FIXED | 29fd2213 |
| 7 | 2 | WARNING | engine.reachable.test.js | false EXCUSED reasons | FIXED | 29fd2213 |
| 8 | 2 | WARNING | server.js | refused-add hooks side-effect | FIXED | 29fd2213 |
| 9 | 3 | WARNING | claudeaccounts.js | .tmp strands a plaintext key | FIXED | ffbe2933 |

### Outstanding questions (ASKED)
None.

### NITs (non-blocking)
- validateLive-before-guard ordering (iter3) --> FIXED. keyProblem docstring (iter2) --> FIXED. checkLive collision-escape (iter2) --> FIXED. storeKey temp window (iter1) --> FIXED. nextWorkDir require-hoist + fail-open comment (iter3) --> FIXED. Missing coverage (iter1) --> FIXED.
- DEFERRED (benign, with reasoning): failed-store cleanup does not remove the empty prepared dir (no credential in it, invisible to list(), reused by nextWorkDir - matches the rejected-key path's harmless leftover); the taken-label guard is a TOCTOU on two concurrent same-label POSTs (single-user local endpoint, the same caveat openaiaccounts carries); the route's failure-cleanup catch is not route-tested (the forgetKey .tmp cleanup it calls IS module-tested).

### Strengths (across all iterations)
- The raw key never reaches settings.json (only the cat-the-file pointer), the HTTP response, git, argv, or logs; it lands only in a temp+rename mode-0600 file. Proven, not asserted: an execSync test plants $(touch PWNED)/backtick/quote/space in the home path and verifies no breakout + exact-key resolution.
- validateLive mirrors openaiaccounts' asymmetry exactly (only authentication_error is NONE; unreachable/non-attributed is UNKNOWN, never a guessed-dead good key); anthropic-version always sent; x-api-key not a Bearer.
- Both billing-contamination directions closed (taken-label guard + nextWorkDir occupancy), keyed on the sanitized dir so case/whitespace variants collapse; the default ~/.claude is structurally unreachable.
- dirForLabel is a clean pure extraction so the guard's sanitization is identical to prepare's by construction; the nextWorkDir lazy require is cycle-safe and fails open safely.
