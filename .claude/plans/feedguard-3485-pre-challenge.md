---
pre_challenge: true
method: challenge-loop
branch: feedguard-3485
diff_hash: 3b9efc97e4ee99bef7a849dc0d0a4689cbc6fa17b2e8d109dda99e239d47387d
validation: passed
subdir_audit: passed
timestamp: 2026-09-23T19:30:58Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7 (6 fix rounds + 1 clean convergence pass)
**Converged:** Yes (iteration 7 returned zero new actionable findings)
**Total findings:** 9 BLOCKERs, 12 WARNINGs, 7 NITs (plus many STRENGTHs)
**Fixed:** all | **Deferred:** 2 documented residuals (a deliberate name re-order `Stone, Josh`; a non-Luhn card representation) | **Asked:** 0

Reviewer models were rotated opus/sonnet across iterations (kosmos#2032), so the
convergence is witnessed by both models. Every iteration through 6 surfaced real
fail-open or DoS defects; the two models found DIFFERENT classes, which is the
whole point of the rotation. Self-generated findings (kosmos#120 sense, the loop
rewriting its own confident-wrong comments): 0. Every finding was a real defect
in the branch's own code, fixed normally; the one stale comment corrected (the
contentFindings doc after the snapshot refactor) was fixed proactively by the
author in the same round, not re-found by a reviewer.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 2 WARNINGs, 2 NITs
**Self-generated:** 0 (nothing had committed yet)
- [BLOCKER] fail-OPEN when JSON.stringify threw (BigInt/circular in an untyped field) dropped the only scan agent/session/at got --> FIXED (be853c8): scan every field directly, type-check v, treat a stringify throw as a finding
- [WARNING] leading \b on token patterns defeatable by a word-char prefix (xAKIA...) --> FIXED
- [WARNING] unbounded content scan CPU-DoS on a huge body --> FIXED (SCAN_CAP)
- [NIT] currency spelled form; [NIT] test gap --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 4 BLOCKERs, 5 WARNINGs, 3 NITs
**Self-generated:** 0
- [BLOCKER] at never type-checked -> a Symbol at smuggled a token past both scans --> FIXED (b841b3e)
- [BLOCKER] many-links CPU-DoS (17.6s for 50 links) + O(n^2) high-entropy lookahead --> FIXED (link-count bound + linear high-entropy fn)
- [BLOCKER] guard(candidate, null) threw (={} default only covers undefined; read outside try) --> FIXED (opts coercion)
- [BLOCKER] missing SSN / card / AWS ASIA leak classes --> FIXED
- [WARNING] non-USD currency; name-denylist evasions (zero-width/newline/full-width); non-enumerable property invisible; findings lose field/count; DoS test gap --> all FIXED (Reflect.ownKeys, NFKC normalize, per-field labels)
- [NITs] Cardano *_xsk, Slack xapp-/xoxe-, at LIMITS --> FIXED

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 2 WARNINGs, 1 NIT
**Self-generated:** 0
- [BLOCKER] full-width-digit PII bypassed ASCII-only \d (pattern scan not NFKC-folded like the name scan) --> FIXED (d5bb2f9): scan an NFKC-folded copy too
- [WARNING] a getter on an allowed field was a TOCTOU vector --> FIXED (accessor detection)
- [WARNING] no-separator 16-digit card slipped --> FIXED (Luhn detector)
- [NIT] name strip too narrow --> FIXED (\p{Cf})

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER
**Self-generated:** 0
- [BLOCKER] accessor check saw only OWN descriptors; a prototype-chain getter or a Proxy with a lying getOwnPropertyDescriptor trap evaded it --> FIXED (b27d999): snapshot the candidate (read each field once) and return it as verdict.post; the board publishes the snapshot, not the live object. bad_prototype refused as the earlier signal.

#### Iteration 5
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 1 WARNING
**Self-generated:** 0
- [BLOCKER] snapshot copied links by REFERENCE, so verdict.post.links === the caller's live array; a caller could mutate it after guard returned clean --> FIXED (914ae7a): deep-copy links into a fresh bounded frozen array
- [WARNING] iteration-4 post tests only exercised scalar body (vacuous re links) --> FIXED (disjoint + post-mutation tests)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 2 WARNINGs
**Self-generated:** 0
- [BLOCKER] name denylist scanned only topic/body, never agent -- the one field that must never be a human username; agent:'Josh Stone' published clean --> FIXED (4625582): name scan now covers agent and session too
- [WARNING] snapshot never actually Object.freeze'd despite the "frozen" claim --> FIXED (freeze object + links)
- [WARNING] a symbol key's raw description echoed into findings via String(key) --> FIXED (redacted to '[symbol key]')

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0
**Self-generated:** 0
**Converged** -- no new actionable findings. The reviewer stress-tested a fresh
Proxy has-trap attack and confirmed the snapshot contract holds (a hidden field
falls to missing_field or lands undefined in the published snapshot, never a leak).

### Final Ledger (representative; all BRANCH origin, all resolved)

| # | Iter | Category | Origin | Description | Status |
|---|------|----------|--------|-------------|--------|
| 1 | 1 | BLOCKER | BRANCH | fail-open on JSON.stringify throw | FIXED be853c8 |
| 2 | 2 | BLOCKER | BRANCH | Symbol at smuggles token | FIXED b841b3e |
| 3 | 2 | BLOCKER | BRANCH | many-links CPU-DoS | FIXED b841b3e |
| 4 | 2 | BLOCKER | BRANCH | guard(cand,null) throws | FIXED b841b3e |
| 5 | 2 | BLOCKER | BRANCH | missing SSN/card/ASIA classes | FIXED b841b3e |
| 6 | 3 | BLOCKER | BRANCH | full-width-digit PII bypass | FIXED d5bb2f9 |
| 7 | 4 | BLOCKER | BRANCH | prototype/Proxy TOCTOU | FIXED b27d999 |
| 8 | 5 | BLOCKER | BRANCH | links copied by reference | FIXED 914ae7a |
| 9 | 6 | BLOCKER | BRANCH | name scan skips agent field | FIXED 4625582 |

### Deferred (documented residuals of a BACKSTOP, not the primary defense)
- A deliberate name RE-ORDER (`Stone, Josh`) is not caught by the substring denylist. The structural minimization rule and the held-by-default moderation queue are the real defenses; the denylist is a backstop for the exact known handles.
- A card number in an unusual representation that fails Luhn is not flagged as a card (Luhn is chosen precisely to keep false positives near zero).

### Strengths (across all iterations)
- Genuine negative-control discipline: every leak class plants a real instance and asserts it is caught, plus a positive control so `clean` is not vacuously always-false.
- Fail-closed holds under every adversarial input tried (BigInt, circular, Symbol, null opts, Proxy, prototype getter, huge body, many links).
- The snapshot/publish-the-snapshot design closes TOCTOU end to end.
- Multi-model rotation (opus/sonnet) surfaced distinct defect classes each round.
- No em dashes in any changed file.
