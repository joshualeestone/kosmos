---
pre_challenge: true
method: challenge-loop
branch: sealedapp2-5896
diff_hash: 44960ec22b7e6e513ad06c841e3a5abddefec7f06d9d908762927eb15a6615d3
validation: passed (Mortals, entry 2026-10-12T13:14:23Z, hash 44960ec22b7e)
subdir_audit: passed
timestamp: 2026-10-12T13:14:58Z
iterations: 16
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 16 (reviewer models alternate, opus on odd iterations, sonnet on even)
**Converged:** Yes (iteration 16 raised one WARNING, a duplicate of the documented ad-hoc-signing limit from iterations 3 and 4)
**BLOCKERs found:** 4, all fixed
**Follow-up cards filed:** #5912 (one-account uninstall leaves the shared icon), #5913 (reuse another account's icon)

### Findings by iteration
| Iteration | Finding | Status |
|---|---|---|
| 1 | BLOCKER uninstall deletes KOSMOS_HOME before proving sealed icon|FIXED (SEALED_REQ captured first)|
| 1 | read-only ditto copy|FIXED chmod u+w|
| 1 | residue sweeps could take another account's sealed leftovers|FIXED (anchored mode, later ownership rule)|
| 1 | AWH elsewhere: sealed placed where app won't read config|FIXED|
| 2 | BLOCKER VAR=x prefix leaks under /bin/sh|FIXED (mode argument; tests under /bin/sh)|
| 2 | per-install fallback clobbers another account's shared icon|FIXED (placement gate)|
| 2 | cut check accepts ad-hoc|FIXED (team requirement)|
| 3 | cross-account replace: undeletable aside, version flip|FIXED (ownership by uid)|
| 3 | own leftovers in ~/Applications never swept|FIXED|
| 3 | cut check not tied to release|FIXED (version)|
| 4 | several|DEFERRED with comments (one install per account, cut is Developer ID)|
| 5 | BLOCKER test-install shared-folder checks|FIXED (shape-aware)|
| 5 | permission re-prompt from identity change|DOCUMENTED (plan)|
| 6 | second custom-home install takes the account's sealed icon|FIXED (config names this install)|
| 7 | own-icon message dead code|FIXED (own mode)|
| 9 | Linux CI red on macOS-only test|FIXED (skip guard)|
| 9 | App Management prompt|DOCUMENTED|
| 10 | text tests skipped on Linux|FIXED|
| 11 | mis-driven harness could uninstall real icon|FIXED (sealed_config_reaches)|
| 11 | failed sealed copy no fallback|FIXED|
| 13 | placement not destination-aware|FIXED (same predicate as recognition)|
| 14 | BLOCKER harness uninstall env asymmetry|FIXED (KOSMOS_HOME_APP_DIR)|
| 15 | test-install probe block not run at a cut|DOCUMENTED (reasoned only; full run owed)|
| 15 | stale-probe transcript check in replace mode|FIXED (own)|

### Not run (owed before trust)
- A real Developer ID build and upgrade: every test bundle is ad-hoc signed.
- The full `yarn test:install` (probe, alias and deep worlds); a cut runs only the gate half.
