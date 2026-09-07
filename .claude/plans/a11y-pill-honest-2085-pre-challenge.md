---
pre_challenge: true
method: challenge-loop
branch: a11y-pill-honest-2085
diff_hash: 65721898ebf690de82fa123a139d3d3a105564c44a4b3c8ec3c331055551d8d2
validation: passed
subdir_audit: passed
timestamp: 2026-09-07T20:14:22Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iterations 2, 3, and 4 each produced zero actionable BLOCKER/WARNING/CONVENTION findings; only NITs)
**Total findings:** 11 (0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 9 NITs)
**Fixed:** 8 | **Deferred:** 3 (NITs) | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
- [WARNING] engine/a11ystatus.js — tmuxGrant spawned sqlite3 synchronously on every 1.5s gate poll, blocking the board's single HTTP thread (up to the 5s timeout on a locked db) --> FIXED (2s TTL memo + timeout 5000->2000ms).
- [WARNING] engine/a11ystatus.js — a path-key mismatch (tmux granted under a different path than the resolved binary) yielded a blocking false "Not activated" that could strand a granted user --> FIXED (one LIKE query -> 3-way: our-path granted=green; our-denied/none-granted=Not activated+Turn On; another-tmux-granted=checkable:false "Checking..." non-blocking).
- [NIT] engine/a11ystatus.js — asymmetric unresolvable-tmux handling --> DEFERRED (reviewer-confirmed minor/defensible).
- [NIT] web/index.html — data-checking set on the inert S2 row --> DEFERRED then documented (iter 2).

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs (CONVERGED - zero actionable)
- [NIT] production (no-opts) cache path untested --> FIXED (spy test via setSqliteRunner + resetGrantCache).
- [NIT] resetGrantCache exported but unused --> FIXED (used by the cache test).
- [NIT] cache comment oversells (path resolution still runs) --> FIXED (tightened).
- [NIT] data-checking on inert S2 row (dup of iter1) --> FIXED (clarifying comment).

#### Iteration 3
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs (CONVERGED - zero actionable)
- [NIT] `LIKE '%tmux%'` substring could rarely mis-classify a non-tmux binary containing "tmux" --> FIXED (tightened to `LIKE '%/tmux'`; +test that a granted tmuxinator does not trigger ambiguity).
- [NIT] "Test seam:" comment undersells the production role --> FIXED ("Production reader (and test seam)").
- [NIT] cache-test teardown installs a stand-in runner rather than snapshotting --> DEFERRED (harmless; last test, node --test isolates files per process).

#### Iteration 4
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs (CONVERGED - zero actionable)
- [NIT] engine/a11ystatus.test.js:93 stale comment `%tmux%` --> FIXED (`%/tmux`).
- [NIT] engine/a11ystatus.test.js:161 stale comment `%tmux%` --> FIXED (`%/tmux`). (Line 181 keeps `%tmux%` deliberately - it names the hypothetical looser match the assertion guards against.)
**Converged** - no new actionable findings; remaining findings were stale-comment corrections from iteration 3's own change.

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/a11ystatus.js | sync sqlite3 spawn blocks event loop every poll | FIXED | 2s memo + 2s timeout |
| 2 | 1 | WARNING | engine/a11ystatus.js | path-mismatch false-red strands a granted user | FIXED | 3-way disposition (ambiguous -> Checking) |
| 3 | 1 | NIT | engine/a11ystatus.js | asymmetric unresolvable-tmux handling | DEFERRED | reviewer-confirmed minor |
| 4 | 1 | NIT | web/index.html | data-checking on inert S2 row | FIXED | clarifying comment (iter 2) |
| 5 | 2 | NIT | engine/a11ystatus.test.js | production cache path untested | FIXED | spy + resetGrantCache test |
| 6 | 2 | NIT | engine/a11ystatus.js | cache comment oversells | FIXED | tightened |
| 7 | 3 | NIT | engine/a11ystatus.js | `%tmux%` too broad | FIXED | `%/tmux` + tmuxinator-exclusion test |
| 8 | 3 | NIT | engine/a11ystatus.js | "Test seam:" comment | FIXED | "Production reader (and test seam)" |
| 9 | 3 | NIT | engine/a11ystatus.test.js | cache-test teardown stand-in runner | DEFERRED | harmless; file isolation |
| 10 | 4 | NIT | engine/a11ystatus.test.js | two stale `%tmux%` comments | FIXED | `%/tmux` |

### NITs (non-blocking, across all iterations)
- Deferred: asymmetric unresolvable-tmux handling (iter1); cache-test teardown installs a stand-in runner rather than snapshotting the original (iter3) - harmless, last test, node --test isolates files.

### Strengths (across all iterations, repeatedly confirmed by independent blind reviewers)
- The "never a false green" invariant is airtight: trusted:true only on an exact realpath match with auth>=2; every other arm (denied, ambiguous other-tmux, none, any read failure, throw, unresolvable path) -> checkable:false or trusted:false. tmuxGrant cannot throw (every external call try/caught) and server.js wraps it again.
- The 3-way disposition avoids BOTH a false green AND a false-red strand (ambiguous other-tmux -> non-blocking "Checking...").
- Security: execFileSync (no shell), -readonly (cannot mutate the TCC store), a fixed literal query (match done in JS off returned rows), 2s timeout.
- Memo cache correctly scoped (key = realpath+dbPath, 2s TTL, bypassed on any test override) - never serves a test-vs-production crossover.
- read() preserved for its remaining consumer (promptrequest.nativePresent); the route keeps the identical {checkable,trusted} shape so frPollGates consumes it unchanged; the fail-safe invariant (only 'blocked' gates Next) is untouched.
- Tests rigorous and non-vacuous: a real /usr/bin/sqlite3 e2e against a TCC-shaped db across granted/ambiguous/none/schema-drift/tmuxinator-exclusion, plus the production no-opts cache path with a counting spy.
- No em dashes anywhere.

### Weakest premise (for the real-install verify, not a code defect)
That the board process can read the system TCC db (needs Full Disk Access) and that TCC keys the grant under realpath(binPaths().tmuxBin). If the board lacks FDA in a real install, the pill shows "Checking..." (honest, never false, never blocks) rather than green even when granted; if the granted path differs from the resolved realpath, the ambiguity arm shows "Checking..." (non-blocking) rather than green. Both are within the safe envelope. Josh's 0.6.47 fresh-install re-test is the verification.
