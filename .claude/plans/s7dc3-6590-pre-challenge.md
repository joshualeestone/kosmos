---
pre_challenge: true
method: challenge-loop
branch: s7dc3-6590
diff_hash: e9158b93837902cea8bf11ef22a3cb794b6106342886ec75a1b5f537bf1e7324
validation: passed
subdir_audit: passed
timestamp: 2026-10-24T01:25:41Z
iterations: 1
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 (a blind review of the whole part).
**Converged:** No: review 1's fixes (one BLOCKER, three WARNING, one NIT) were not re-reviewed; the two NITs it did
not take are decided in s7dc3-6590.md.
**Validation:** the Mortals full suite on head 9bf53e5320, rebased onto main after c2 (#7009) merged:
**23634 tests, 0 failed** (hash e9158b938379, the diff this proof hashes). Its first run, at 39f44dbff9, failed one test:
the #1720 browser-check gate (run inside tools.shell-shard-4317.test.js) on this part's one web/index.html line, which
had no browser assertion. Fixed by T6d in docs/browser-checks/render-typed-allow-6590.js (it fails with that line
removed).
**Order constraint:** this part needs the relay's `reason` field (kosmos-relay #574, merged 2026-10-23 13:21). Met.
**Inert:** nothing here changes behaviour until the board-v2 marker exists (a later part writes it).

### Per-iteration breakdown (details in s7dc3-6590.md)
#### Iteration 1: 1 BLOCKER, 3 WARNING, 3 NIT
- [BLOCKER] a secret retired during the waiting-list read was still used once --> FIXED (re-checked after every wait; tests)
- [WARNING] Not me after an automatic Allow was left to the person --> FIXED (the board takes it back out and says so)
- [WARNING] four mutants survived --> tests added (the busy guard in the tick stays unpinned, stated)
- [WARNING] no_row/ambiguous retry without the relay's reason --> order constraint, met (above)
- [NIT] a wrong-shaped allow id kept the secret --> FIXED; two NITs DECIDED (see the plan)

### Weakest premise
That re-checking after the read closes every way the secret can be retired mid-tick; the tests pin switch-off and a
moved epoch, and the busy guard covers register and Forget without a test of its own.
