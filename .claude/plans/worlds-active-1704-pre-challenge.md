---
pre_challenge: true
method: challenge-loop
branch: worlds-active-1704
diff_hash: 886d9de4cc73a264315463871431821d14fbf6908f15c65a13b6e6a5e6f12f94
validation: passed
subdir_audit: passed
timestamp: 2026-09-05T06:10:35Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3 produced zero NEW BLOCKER/WARNING/CONVENTION findings)
**Total actionable findings:** 4 WARNINGs, 4 NITs (0 BLOCKERs, 0 CONVENTIONs)
**Fixed:** 5 | **Deferred:** 3 | **Asked:** 0

Adds POST /api/worlds/active (#1704 slice 2b-ii): the registry world-switch endpoint.
Full suite green (hash 886d9de4cc73, 0 failed) after the 0.6.31 re-cut box-claim cleared.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
- [WARNING] server.js -- 404-vs-500 classified by regex-matching the engine's error text (couples the route to setActiveWorld's wording) --> FIXED (ca47d706): typed ENOWORLD code; route branches on err.code.
- [WARNING] server.js -- registry lock-contention swallowed into a generic 500, dropping the retryable signal --> FIXED (ca47d706): typed EWORLDLOCK code; route returns 409 with the "try again" copy.
- [NIT] server.js -- restartRequired: true is unconditional (over-signals a no-op default->default switch) --> DEFERRED: conservative and safe; the route does not track the RUNNING board's boot-world, so it cannot tell a no-op from a real switch, and a redundant restart reloads the same world harmlessly. Documented in the route comment; precise restartRequired is a follow-up.

#### Iteration 2
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
- [WARNING] engine.reachable.test.js -- setActiveWorld's orphan-guard excuse was now self-invalidating: it said "no caller yet, remove when 2b wires the switch" and this slice wires exactly that caller, so leaving it silently disabled the #265 guard for that export --> FIXED (9fe03449): removed the excuse; the content-driven guard now finds the real server.js caller (confirmed by iter 3).
- [WARNING] server.js -- the route comment overclaimed "matches how the sibling create route treats the same condition" (true only of the copy, not the status: sibling returns 400 for the same lock) --> FIXED (9fe03449): comment corrected to state the 400-vs-409 divergence and that the sibling's 400 is a pre-existing wart.
- [NIT] server.test.js -- the 409 test's base derivation (baseRoot(process.env)) equals the route's worldBase() only because the default world is active; undocumented --> FIXED (9fe03449): added a note that a divergence would fail the 409 assert loudly, not silently pass.

#### Iteration 3
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Converged** -- all iter 1 & 2 fixes independently confirmed correct (typed-code classification, safe excuse removal, no message leakage, no regression to the sibling route).
- [NIT] server.js -- only POST is handled; a GET/other method falls through to the generic 404 rather than 405 --> DEFERRED: harmless, explicitly "not required", and consistent with the sibling /api/worlds (whose other methods also fall through).
- [NIT] server.js -- the trailing .catch can echo a readBody rejection message --> DEFERRED: identical pattern to the sibling POST route, controlled JSON-parse path throws fixed copy; not introduced here.

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | WARNING | server.js | 404-vs-500 by string-matching engine error | FIXED | ca47d706 (typed ENOWORLD) |
| 2 | 1 | WARNING | server.js | lock contention swallowed to 500 | FIXED | ca47d706 (typed EWORLDLOCK -> 409) |
| 3 | 1 | NIT | server.js | restartRequired unconditional | DEFERRED | conservative; boot-world not tracked; documented |
| 4 | 2 | WARNING | engine.reachable.test.js | stale orphan-excuse disables guard | FIXED | 9fe03449 (removed excuse) |
| 5 | 2 | WARNING | server.js | comment overclaimed sibling parity | FIXED | 9fe03449 (states divergence) |
| 6 | 2 | NIT | server.test.js | base-equality precondition undocumented | FIXED | 9fe03449 (noted) |
| 7 | 3 | NIT | server.js | no 405 for non-POST | DEFERRED | optional; consistent with sibling |
| 8 | 3 | NIT | server.js | .catch may echo readBody msg | DEFERRED | pre-existing pattern; consistent with sibling |

### Outstanding questions (ASKED)
None.

### Strengths (across all iterations)
- Typed error codes classify by err.code, never message text; both lock-throw sites route through the shared worldLockBusyError() helper so both carry EWORLDLOCK (iter 1, 2, 3).
- Security sound: id is only equality-matched against the registry, never path-joined; existing ids are CLEAN_ID-filtered; a crafted id resolves to 404 with no traversal (iter 1, 2, 3).
- No message leakage: all error responses use fixed person-facing copy; the 500 path never echoes the internal dataRootFor message (iter 1, 3).
- No regression: adding .code preserves the exact prior messages, so the sibling create route and the /no such world/ + /in progress/ test assertions still hold (iter 3).
- Tests exercise the codes and a real 409 held-lock route path; restore-to-default teardown prevents active-world pollution of later tests (iter 1, 2, 3).
- Scope split (registry switch now; board-restart lifecycle + launchd deferred) matches the module's documented v1 scope and avoids a fleet-affecting board self-restart on a shared box (iter 1, 3).
- No em dashes in any changed line (iter 3).
