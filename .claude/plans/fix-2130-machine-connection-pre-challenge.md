---
pre_challenge: true
method: challenge-loop
branch: fix-2130-machine-connection
diff_hash: 60e8e82e7e201116aa0f8c90b1b64fda14567b891c17930c3655a591ec132632
validation: passed
subdir_audit: passed
timestamp: 2026-09-04T16:46:09Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3 produced zero NEW BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 2 WARNINGs, 0 BLOCKERs, 0 CONVENTIONs, 5 NITs
**Fixed:** 2 WARNINGs + 2 NITs | **Deferred:** 3 NITs (documented) | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
- [WARNING] engine/firstrun.js:135 - the rewire falsified a cross-file comment claiming the 5s status tick "keeps checkCached()"; it now reads checkMachine(). --> FIXED (7b3ef115): corrected the comment (still a cached poll) and dropped the already-stale server.js:1702 line ref.
- [NIT] test clean(): dead `rm() ||` short-circuit (rm returned undefined so the recursive branch always ran). --> FIXED (7b3ef115): simplified clean(), removed the unused rm helper.
- Self-found sweep: a SECOND stale checkCached comment in engine/connect.js:2215 (same class). --> FIXED (1fc79ffd).

#### Iteration 2
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
- [WARNING] engine/subscription.js - checkMachine() called accounts.list() every 5s tick, re-parsing every config (incl. the ~95KB default); a SECOND list() since the status handler already computed known = accounts.list(). --> FIXED (a19c554a): checkMachine now accepts the caller's list; the banner call site threads server.js's known in; steady-state tick only stats configs. Added a threaded-path test.
- [NIT] machineStatKey does its own require('./accounts') while checkMachine already required it. --> DEFERRED: Node caches the module and computeMachine's check({configDir}) lazy-requires it too, so a shared ref would not remove the pattern.

#### Iteration 3
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Converged** - no NEW actionable findings.
- [NIT] checkCached() now has no production caller (the tick moved to checkMachine(known)). --> DEFERRED: it remains an exported, tested public API and connect.js documents it as checkMachine's single-account sibling; removing it is out of scope for this fix. Noted for awareness.
- [NIT] the "threaded matches self-fetched" test did not discriminate that the passed list is consulted (deepEqual passes even if the arg were ignored). --> FIXED (f82807f4): added checkMachine([]) -> not-connected against a connected non-default dir, which can only pass if the empty list is honored.
- [NIT] computeMachine's check({configDir}) lazy-requires './accounts' unguarded, asymmetric with machineStatKey's guard. --> DEFERRED: not reachable today - a non-empty accts implies accounts.list() already succeeded upstream, so the module is loadable whenever the loop runs.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/firstrun.js:135 | stale checkCached cross-file comment | FIXED | 7b3ef115 |
| 2 | 1 | NIT | test clean() | dead rm() short-circuit | FIXED | 7b3ef115 |
| 3 | 1 | WARNING | engine/connect.js:2215 | second stale checkCached comment (self-found) | FIXED | 1fc79ffd |
| 4 | 2 | WARNING | engine/subscription.js | per-tick accounts.list() re-parse | FIXED | a19c554a |
| 5 | 2 | NIT | engine/subscription.js:532 | machineStatKey own require | DEFERRED | Node module cache; unavoidable pattern |
| 6 | 3 | NIT | engine/subscription.js:477 | checkCached now no prod caller | DEFERRED | tested public API, documented sibling |
| 7 | 3 | NIT | test:61 | threaded test non-discriminating | FIXED | f82807f4 |
| 8 | 3 | NIT | engine/subscription.js:515 | unguarded require in computeMachine | DEFERRED | not reachable (accts non-empty implies loadable) |

### Strengths (across all iterations)
- Cache correctness by construction: machineStatKey stats exactly the files computeMachine reads, so any verdict-altering change (downgrade, sign-out, new sign-in) alters the key; two account lists cannot collide on one key with different verdicts (each file path embedded).
- No per-account scoped because-string can leak into the machine banner: a non-default account's verdict is returned only when CONNECTED, whose because is machine-level; NONE/UNKNOWN always fall through to the default base.
- Tests genuinely discriminate: the core test reproduces the bug as a control (checkCached NOT connected), the cache test rewrites a non-default dir and asserts re-read, the wording test pins /on this computer/, and the threaded test proves the arg is consulted.
- Composes cleanly with #2128: making connection connected in more cases only further suppresses the banner, which is #2130's intent; renderConnection payload shape unchanged.
