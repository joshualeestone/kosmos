---
pre_challenge: true
method: challenge-loop
branch: storemode-1760
diff_hash: 20a67afc007a3eaab6d7ed8e84b6630900742cc2687600fdd49c05594276b556
validation: passed
subdir_audit: passed
timestamp: 2026-10-29T07:59:39Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. It stopped at the fleet's 8-round cap: Splinter's usage rule of 2026-10-22 11:08, "review loops cap at 8 rounds (past 8 only while a BLOCKER is open), leftover warnings go to a follow-up card". No BLOCKER was open at iteration 8. Its three WARNINGs are carried on kosmos#7554 (April owns it).
**Total findings:** 18 (0 BLOCKERs, 17 WARNINGs, 1 CONVENTION, 30 NITs)
**Fixed:** 13 | **Deferred:** 2 | **Carried to #7554:** 3 | **Asked (awaiting user):** 0

Final validation (6j), first run at 1b40efe90d: 1 fail. `engine/windows-tests-1777.test.js` requires a test that branches on a win32 host to be listed for Windows, and the suite's leak check named a temp dir the new test left. Both fixed in 477b7c1d8a (a HOST_BRANCH_EXCLUDED entry with its reason; `require('../test-support/tmpscope')`). Re-run at 477b7c1d8a: 25596 tests, 0 fail, 0 cancelled, shell suite all pass, helper "validation PASSED ... hash=20a67afc007a".

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/store.js:455 - the root is tightened only via ensure(); seven other sites mkdir it under the umask --> FIXED (b255b8a5fc): secureRoot() at board start plus ensure(); the other sites are recorded in the plan
- [WARNING] engine/messages.js:1128 - an upgraded install's existing log keeps 0644 --> FIXED (b255b8a5fc): secureLog() at board start, which leaves a link alone; test
- [CONVENTION] plan "Why now" premise inaccurate --> FIXED (b255b8a5fc)
- NITs: duplicated root expression (fixed in 6), symlink note, temp cleanup (fixed), win32 skip (fixed)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] chmod of a shared AGENT_WORKFORCE_DATA folder --> DEFERRED: root() is `<DATA>/<app>` (store.js:96), never the named folder
- [WARNING] chmod and root() on every ensure() --> FIXED (1e582e8525): once per root per process
- [WARNING] silent failure leaves the root readable --> FIXED (1e582e8525): one stderr line at board start
- [WARNING] board-start calls not in try --> FIXED (1e582e8525)
- [CONVENTION] brittle source regex --> FIXED (1e582e8525): loosened

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 8 NITs
**Self-generated:** 1 of the above (the plan's weakest premise, written in iteration 1)
- [WARNING] plan claims ensure() re-tightens on the next write --> FIXED (fbf4aa5e93): reworded; Known limits added
- NITs taken: failed chmod recorded; sandbox assertion; message wording; the loaded `messages` module used

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above (the iteration-3 ENOENT recording)
- [WARNING] a root that does not exist yet is marked secured --> FIXED (1be45c0d5e): ENOENT not recorded; test, shown red under the mutation
- [WARNING] a symlinked root's target is chmodded --> DEFERRED: the target holds the store's own data, so tightening it is #1760's point

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1 of the above (the secureRoot comment)
- [WARNING] the comment reads as "always 0700" --> FIXED (6c82b91050): the comment cut to what the code does; plan Why now and Known limits corrected

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above (root() in ensure, from iteration 2)
- [WARNING] ensure() runs root(), which can trigger the legacy migration --> FIXED (dc7940abae): currentDataRoot(), shared with root(), no migration
- [WARNING] KOSMOS_ALLOW_REAL_ROOT test could chmod the real root --> FIXED (dc7940abae): skipped in a test process; child-process test with chmodSync stubbed, shown red under the mutation

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above (the iteration-6 test)
- [WARNING] the real-root test can pass vacuously under a sandboxed HOME --> FIXED (1b40efe90d): the child is given the real home by name and asserts it resolved the real root
- [WARNING] test 1 depends on no earlier ensure() --> FIXED (1b40efe90d): its own data folder

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] ensure() resolves the root on every call --> CARRIED to kosmos#7554
- [WARNING] a transient EPERM/EBUSY is recorded as tried --> CARRIED to kosmos#7554
- [WARNING] board-start hardening only when boardAuthState.on --> CARRIED to kosmos#7554 (Kitty's reading: a real board enforces)
**Stopped at the 8-round cap** (no BLOCKER open).

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/store.js:455 | BRANCH | root tightened only via ensure | FIXED | b255b8a5fc |
| 2 | 1 | WARNING | engine/messages.js:1128 | BRANCH | upgraded log keeps 0644 | FIXED | b255b8a5fc |
| 3 | 1 | CONVENTION | plan | BRANCH | Why-now premise | FIXED | b255b8a5fc |
| 4 | 2 | WARNING | engine/store.js:459 | BRANCH | shared DATA folder | DEFERRED | leaf only (store.js:96) |
| 5 | 2 | WARNING | engine/store.js:464 | BRANCH | chmod every ensure | FIXED | 1e582e8525 |
| 6 | 2 | WARNING | engine/store.js:459 | BRANCH | silent failure | FIXED | 1e582e8525 |
| 7 | 2 | WARNING | server.js:26662 | BRANCH | no try | FIXED | 1e582e8525 |
| 8 | 3 | WARNING | plan:27 | SELF | weakest premise wrong | FIXED | fbf4aa5e93 |
| 9 | 4 | WARNING | engine/store.js:464 | SELF | ENOENT marked secured | FIXED | 1be45c0d5e |
| 10 | 4 | WARNING | engine/store.js:465 | BRANCH | symlinked root | DEFERRED | target is the store |
| 11 | 5 | WARNING | engine/store.js:455 | SELF | comment overstates | FIXED | 6c82b91050 |
| 12 | 6 | WARNING | engine/store.js:467 | SELF | migration trigger | FIXED | dc7940abae |
| 13 | 6 | WARNING | engine/store.js:461 | BRANCH | real root in tests | FIXED | dc7940abae |
| 14 | 7 | WARNING | test:89 | SELF | vacuous pass | FIXED | 1b40efe90d |
| 15 | 7 | WARNING | test:24 | BRANCH | order dependence | FIXED | 1b40efe90d |
| 16 | 8 | WARNING | engine/store.js:475 | SELF | resolve per call | CARRIED | #7554 |
| 17 | 8 | WARNING | engine/store.js:469 | BRANCH | transient chmod failure | CARRIED | #7554 |
| 18 | 8 | WARNING | server.js:26663 | BRANCH | auth-off boards | CARRIED | #7554 |

### Outstanding questions (ASKED)
None.

### NITs (non-blocking, across all iterations)
- secureLog lstat-then-chmod window (iterations 3, 5, 6, 7): owner-only root, accepted
- board-start test is a source check (iterations 2-8): stated in the plan's Known limits
- plan file name has no timestamp (iteration 8)
- others as listed per iteration above

### Strengths (across all iterations)
- Every behaviour test sets its own precondition (0755, umask 022), and each was shown red under its own mutation
- The real data root is never touched by a test: throwaway roots, plus a stubbed-chmod child for the real-root guard
- The board-start hardening is gated like removal.reapplyAtBoardStart, wrapped, and warns once
