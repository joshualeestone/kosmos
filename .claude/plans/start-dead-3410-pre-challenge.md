---
pre_challenge: true
method: challenge-loop
branch: start-dead-3410
diff_hash: 18f904c85736c8385da1014fd254d578dc5001e2e1d0dbfaa6d4f89dd47ac486
validation: passed
subdir_audit: passed
timestamp: 2026-09-22T23:39:22Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3 found zero issues of any category)
**Total findings:** 4 (0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 1 NIT)
**Fixed:** 3 | **Deferred:** 1 (NIT) | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
- [WARNING] no test asserted disruption.active is truthy after a SUCCESSFUL fromDead start (plan claimed the board shows "starting"). --> FIXED (09c2036): assert disruption recorded on the success path + clear in finally.
- [NIT] fromDead PARTIAL "another try" vs live "another restart". --> DEFERRED: the wording difference is correct (a never-run agent is started, not restarted).

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs
- [WARNING] restartInner has FIVE callers; starting a dead agent silently changed the model/provider/account config-SWITCH routes too (side-effect start + wrong "starting again" copy) -- an undiscussed scope expansion (plan wrongly said "no route change"). --> FIXED (34644e1): scoped the dead-start behind a `startIfDead` opt-in; only the two explicit restart affordances (POST /restart -- Mona's Start button -- and /trust-and-restart) opt in; the three switch routes keep prior behavior. Whether a switch should also start a dead agent is a deliberate follow-up.
- [WARNING] the dead-agent PARTIAL test drove a hard bootstrap failure, so the loaded-verify (print) was never reached on the fromDead path; the bootstrap-0-but-not-loaded sub-case was only tested for FOUND.OURS. --> FIXED (34644e1): added a fromDead bootstrap-ok + print-fails PARTIAL test asserting `launchctl print` actually ran.

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 (no BLOCKER/WARNING/CONVENTION/NIT)
**Converged.** Verified: startIfDead threaded end to end; verdict correct across all four FOUND kinds AND both flag values; exactly the two affordance routes opt in and the three switch routes do not (all 5 call sites checked); null session never reaches the kill; disruption begin/clear correct; loaded-verify runs on the dead path; message honesty; tests non-vacuous; scoping is the right call.

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/remove.test.js | BRANCH | no positive disruption-recorded test for fromDead start | FIXED | 09c2036 |
| 2 | 1 | NIT | engine/remove.js | BRANCH | "another try" vs "another restart" wording | DEFERRED | intentional: start vs restart |
| 3 | 2 | WARNING | server.js/engine/remove.js | BRANCH | dead-start silently changed the config-switch routes | FIXED | 34644e1 (startIfDead opt-in) |
| 4 | 2 | WARNING | engine/remove.test.js | BRANCH | loaded-verify untested on the fromDead path | FIXED | 34644e1 |

### Outstanding questions (ASKED)
None.

### Strengths (across the loop)
- fromDead derivation narrow (FOUND.NONE only); FOUND.UNTIED/UNKNOWN still refuse (bystander protection); null session never reaches sessionOps.end (kill skipped via the fromDead ternary).
- Reuses the exact #3418 relaunch + loaded-verify, so a dead-start that bootstraps 0 but never loads is caught (PARTIAL), tested on the dead path.
- startIfDead scoping verified at all 5 restart call sites: the two restart affordances opt in, the three config switches do not; no regression to #3410's goal and no side-effect start on a switch.
- Message honesty across every branch (no false "again", no false "closed window"); win32 arm protected automatically via the shared ops.
- No route-mapping change needed (RESTARTED/PARTIAL -> 200, REFUSED -> 400); non-vacuity measured against origin/main (both dead-start tests fail without the fix).
