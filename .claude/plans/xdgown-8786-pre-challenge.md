---
pre_challenge: true
method: challenge-loop
branch: xdgown-8786
diff_hash: e94ebe1359593025f045fa3cd2accf4ce1ab5eef065d9b07ad779bb65dde2eb8
validation: pending (Mortals full validation queued after this proof; the targeted tests pass locally: the shell test, install.linux-board-4920, linuxjob, linuxjob.runtimedir-8786, every-test-runs, 57 node tests)
subdir_audit: passed
timestamp: 2026-11-20T14:14:00Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (round 4 raised no change-worthy finding; its warning restates a documented, deliberate difference)
**Total findings:** 18 (0 BLOCKERs, 6 WARNINGs, 1 CONVENTION, 11 NITs)
**Fixed:** 11 | **Deferred:** 7 | **Asked (awaiting user):** 0

Validation note: the full suite is run on Mortals through the fleet's queue after this proof (the fleet's rule); this file is updated with its result before the PR merges.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] install/kosmos ownership check untested --> FIXED (the test lifts and runs it)
- [WARNING] no CI run of the cross-user path on real systemd --> DEFERRED: the Hetzner measurement on #8786 is the end-to-end proof; worth a follow-up
- [CONVENTION] the root message misstated test -O --> FIXED
- [NIT] two copies of the rule differ at the edges --> FIXED (a comment says why the CLI only switches to an existing folder)
- [NIT] the no-unset-default guard matched one spelling --> FIXED (exactly one export of the variable)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/linuxjob.js ensureRuntimeDir still had the unset-only default --> FIXED (ownership check, new test)
- [WARNING] the CLI case could SKIP in CI --> FIXED (runs everywhere on a test folder)
- [NIT] setup.sh switches to a missing folder, the CLI does not --> DEFERRED: commented, both safe
- [NIT] env -u in the test --> FIXED
- [NIT] the call count allows a fourth call --> DEFERRED: the single-export check backs it

#### Iteration 3
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above (the root branch written in iteration 1)
- [WARNING] run as root the test failed instead of skipping --> FIXED (SKIP, as its siblings)
- [NIT] the CLI lacked the folder test --> FIXED
- [NIT] real versus effective uid --> FIXED (comment)
- [NIT] realRunner's comment restated the old rule --> FIXED
- [NIT] root's DBUS_SESSION_BUS_ADDRESS also passes through runuser --> DEFERRED: out of scope, recorded on #8786 as a known residual

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING (a restatement), 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] no test pins the CLI's stay-put case (foreign folder, no /run/user/<uid>) --> DEFERRED: deliberate, commented in both places, no regression
- [NIT] real uid --> DEFERRED (duplicate, commented)
- [NIT] the root case is skipped on a root runner --> DEFERRED: the engine test covers it
- [NIT] the lift keys on a comment --> DEFERRED: a reword fails loudly
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | install/kosmos | BRANCH | CLI ownership check untested | FIXED | iteration 1 commit |
| 2 | 1 | WARNING | .github/workflows | BRANCH | no real-systemd cross-user CI run | DEFERRED | follow-up |
| 3 | 2 | WARNING | engine/linuxjob.js | BRANCH | third unset-only default | FIXED | iteration 2 commit |
| 4 | 2 | WARNING | tools/test-setup-xdg-own-8786.sh | SELF | CLI case could skip | FIXED | iteration 2 commit |
| 5 | 3 | WARNING | tools/test-setup-xdg-own-8786.sh | SELF | root run failed | FIXED | iteration 3 commit |
| 6 | 4 | WARNING | install/kosmos | BRANCH | stay-put case untested | DEFERRED | deliberate |

### NITs (non-blocking, across all iterations)
- setup.sh and the CLI differ when /run/user/<uid> is missing (iterations 2 and 4)
- a fourth call would pass the count (iteration 2)
- the lift keys on a comment line (iteration 4)

### Strengths (across all iterations)
- one helper at all three setup.sh systemd sites, enforced by a single-export guard (all rounds)
- the same rule reaches setup.sh, the CLI and the engine (iterations 2 to 4)
- every test has an own-folder control and reds on a mutation back to unset-only (all rounds)
