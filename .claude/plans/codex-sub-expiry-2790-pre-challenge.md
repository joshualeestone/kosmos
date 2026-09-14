---
pre_challenge: true
method: challenge-loop
branch: codex-sub-expiry-2790
diff_hash: 63a5c91427f49a38af341d8ff24be373431f9fcba6ced613fbf82fa3f084b119
validation: passed
subdir_audit: passed
timestamp: 2026-09-11T20:18:12Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes -- the CODE converged at iteration 2 (zero code findings) and held at
iteration 3; iteration 3's only actionable finding was a stale plan-doc section (self-
introduced in the iter1 revision), fixed without touching code.
**Total findings:** 6 (0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 3 NITs)
**Fixed:** 6 | **Deferred:** 0 | **Asked:** 0

Reviewer model rotation: opus (1), sonnet (2), opus (3). Multi-model convergence.
Validation: `node --test` on the new suite (9) + existing openaiaccounts/chatgpt suites and
the full engine suite (3397) green each iteration; `node -c` clean; no em dashes.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0
- [WARNING] the red rested on an unverified premise -- a WORKING but idle sub whose short
  token merely expired carries a stale past window and would be false-reddened (inverted #874)
  --> FIXED (26a009c1): gate the red on the token's own JWT `exp` being in the FUTURE, so a
  stale token stays grey; added the stale-token safety test + its negative control.
- [WARNING] the helper accepted `active_until` only as a string, so a numeric type would go
  silently inert --> the real claim's type is a confirmed ISO string; documented, and iter3
  added the explicit silent-inert (not safety) note.
- [NIT] the JWT-payload decode was duplicated with identityFromData --> FIXED (26a009c1):
  extracted the shared `decodeIdTokenPayload`.

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs  (CODE CONVERGED)
**Self-generated:** 0
- [NIT] pin the hostile claim-shapes fail-open explicitly (auth as string/array, active_until
  numeric, exp string/fractional) --> FIXED (fb48ddf3): added those unit cases.
- [NIT] a stray blank line in module.exports --> FIXED (fb48ddf3).
Verified independently: predicate re-derived, exp seconds->ms conversion, both negative
controls bite, decode refactor behaviour-preserving, full engine suite (3397) green.

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 0
- [CONVENTION] the plan's "The change" section still named the OLD single-value helper, not
  the shipped chatgptSubscriptionWindow + decodeIdTokenPayload + exp-gate design --> FIXED
  (2403bb77): rewrote it. Doc only; no code change.
- [NIT] note a numeric active_until is silent-inert (not a safety) risk --> FIXED (2403bb77).
- [NIT] the exp-non-finite test arm now actually injects Infinity/NaN --> FIXED (2403bb77).
Re-derived the safety predicate clean; both negative controls confirmed to bite.

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | openaiaccounts.js | BRANCH | Red rested on an unverified fresh-token premise (false-red risk) | FIXED | 26a009c1 (exp gate) |
| 2 | 1 | WARNING | openaiaccounts.js | BRANCH | active_until string-only -> numeric type silently inert | FIXED | documented (real type is ISO string) |
| 3 | 1 | NIT | openaiaccounts.js | BRANCH | JWT decode duplicated | FIXED | 26a009c1 (shared decode) |
| 4 | 2 | NIT | test | BRANCH | Hostile claim-shapes not explicitly tested | FIXED | fb48ddf3 |
| 5 | 2 | NIT | openaiaccounts.js | SELF | Stray exports blank line | FIXED | fb48ddf3 |
| 6 | 3 | CONVENTION | plan | SELF | "The change" section stale after the iter1 redesign | FIXED | 2403bb77 |

### Outstanding questions (ASKED)
None.

### Strengths (across iterations)
- Safety holds and is guarded: red requires exp>now AND activeUntil<now; a working/refreshed
  sub (future window) and a stale-token idle sub (past exp) both stay grey; every parse-doubt
  fails open. Both negative controls bite (remove-red fails the lapsed test; remove-exp-gate
  fails the stale-token test), so neither guard is vacuous.
- verdict()'s observed overlay is a second safety layer: a fresh observed OK returns 'working'
  before checkLive is consulted, so even a mis-fired NONE cannot red a sub completing turns.
- decodeIdTokenPayload sharing keeps the two reads of one token from drifting; the refactor is
  behaviour-preserving (existing suites green). No em dashes (all five spellings, UTF-8-safe).
