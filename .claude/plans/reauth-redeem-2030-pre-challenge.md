---
pre_challenge: true
method: challenge-loop
branch: reauth-redeem-2030
diff_hash: a7139e2b0f8c76493c6aa3ee268298c2bdef156fe2a5a3ef14c5d1628b066440
validation: passed
subdir_audit: passed
timestamp: 2026-09-03T16:27:00Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** Yes
**Total findings:** 3 (0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs)
**Fixed:** 0 | **Deferred:** 0 | **Asked (awaiting user):** 0

The change is a security-sensitive board-auth marker-timing move (kosmos#2030): the
one-time `.reauth-seeded` marker now writes on a genuine `?boot=` nonce REDEMPTION
(server-side, `engine/boardauth.js` `seedReauthMarker` flagged via `bootstrap`'s
`viaBootNonce`, called from `server.js`'s bootstrap handler) rather than by
`install/setup.sh` at browser-open dispatch. Iteration 1 verified the security
properties directly and returned no actionable findings.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Converged** — no new actionable findings; only NITs, which do not trigger re-iteration.
- [NIT] install/setup.sh (open block) — `_minted_nonce`/`_opened` are assigned but no
  longer read (their only consumer was the removed dispatch-time seed block). Left set,
  so no `set -u` breakage. --> NOTED, not changed: a documented minimal-diff decision for
  this security path (prunable separately); left for Baron's review to weigh.
- [NIT] engine/boardauth.js (bootstrap doc / ~line 350) — the word "PURE" is loose since
  `bootstrap` calls `redeemNonce`, an in-memory nonce-burn mutation. --> NOTED, not
  changed: the pre-existing codebase docstring already calls `bootstrap` "PURE" (line 331)
  with that same mutation present, meaning "no filesystem/I-O side effect." My comment uses
  the codebase's own established sense; fixing the term is a pre-existing, codebase-wide
  wording nuance, out of this card's scope.
- [NIT] server.js (bootstrap handler) — `seedReauthMarker()` does synchronous
  `mkdirSync`/`writeFileSync` on the HTTP request path. --> NOTED, not changed: the
  reviewer itself judged it not worth changing given it fires only on rare `?boot=`
  redemptions and the write is tiny.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | NIT | install/setup.sh | dead `_minted_nonce`/`_opened` vars | NOTED | documented minimal-diff decision; prunable separately |
| 2 | 1 | NIT | engine/boardauth.js | "PURE" wording (nonce burn) | NOTED | matches pre-existing docstring usage; out of scope |
| 3 | 1 | NIT | server.js | sync fs write on request path | NOTED | reviewer judged not worth changing (rare + tiny) |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] install/setup.sh — dead `_minted_nonce`/`_opened` (iteration 1)
- [NIT] engine/boardauth.js — "PURE" wording nuance (iteration 1)
- [NIT] server.js — sync fs write on the request path (iteration 1)

### Strengths (across all iterations)
- The marker write is out of the pure decision path: `bootstrap` only adds a
  `viaBootNonce` flag on the genuine redemption branch; the caller does the write. (iter 1)
- Seeding fires only on a real `?boot=` redemption (inside `boot && redeemNonce(boot)`); a
  `?token=` bootstrap and a garbage/expired boot do not seed. Not attacker-triggerable —
  minting requires the board token and the handler runs only under `boardAuthState.on`. (iter 1)
- `seedReauthMarker()` is genuinely best-effort/non-gating: try/catch, return ignored, the
  302 with the cookie proceeds regardless — the self-healing retry is preserved. (iter 1)
- Single source of truth for the marker path (`store.ROOT`), the same path setup.sh reads;
  exactly one prod write site, setup.sh only reads. (iter 1)
- Thorough tests with falsifiable controls (engine flags viaBootNonce on ?boot= not ?token=;
  server writes on real redemption, not on ?token= or garbage), and both files run under the
  suite's `*.test.js` glob. (iter 1)
