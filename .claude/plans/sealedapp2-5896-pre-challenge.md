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

## Per-Iteration Breakdown

#### Iteration 1
- [BLOCKER] uninstall deletes KOSMOS_HOME before proving sealed icon --> FIXED (SEALED_REQ captured first)
- [WARNING] read-only ditto copy --> FIXED chmod u+w
- [WARNING] residue sweeps could take another account's sealed leftovers --> FIXED (anchored mode, later ownership rule)
- [WARNING] AWH elsewhere: sealed placed where app won't read config --> FIXED

#### Iteration 2
- [BLOCKER] VAR=x prefix leaks under /bin/sh --> FIXED (mode argument; tests under /bin/sh)
- [WARNING] per-install fallback clobbers another account's shared icon --> FIXED (placement gate)
- [WARNING] cut check accepts ad-hoc --> FIXED (team requirement)

#### Iteration 3
- [WARNING] cross-account replace: undeletable aside, version flip --> FIXED (ownership by uid)
- [WARNING] own leftovers in ~/Applications never swept --> FIXED
- [WARNING] cut check not tied to release --> FIXED (version)

#### Iteration 4
- [WARNING] several --> DEFERRED with comments (one install per account, cut is Developer ID)

#### Iteration 5
- [BLOCKER] test-install shared-folder checks --> FIXED (shape-aware)
- [WARNING] permission re-prompt from identity change --> DOCUMENTED (plan)

#### Iteration 6
- [WARNING] second custom-home install takes the account's sealed icon --> FIXED (config names this install)

#### Iteration 7
- [WARNING] own-icon message dead code --> FIXED (own mode)

#### Iteration 9
- [WARNING] Linux CI red on macOS-only test --> FIXED (skip guard)
- [WARNING] App Management prompt --> DOCUMENTED

#### Iteration 10
- [WARNING] text tests skipped on Linux --> FIXED

#### Iteration 11
- [WARNING] mis-driven harness could uninstall real icon --> FIXED (sealed_config_reaches)
- [WARNING] failed sealed copy no fallback --> FIXED

#### Iteration 13
- [WARNING] placement not destination-aware --> FIXED (same predicate as recognition)

#### Iteration 14
- [BLOCKER] harness uninstall env asymmetry --> FIXED (KOSMOS_HOME_APP_DIR)

#### Iteration 15
- [WARNING] test-install probe block not run at a cut --> DOCUMENTED (reasoned only; full run owed)
- [WARNING] stale-probe transcript check in replace mode --> FIXED (own)

Iterations 8 and 12 have no row in the loop ledger: no finding from them was recorded as needing action.

#### Iteration 16
- [WARNING] duplicate of the documented ad-hoc-signing limit (iterations 3 and 4) --> DUPLICATE. Converged.

### Not run (owed before trust)
- A real Developer ID build and upgrade: every test bundle is ad-hoc signed.
- The full `yarn test:install` (probe, alias and deep worlds); a cut runs only the gate half.
