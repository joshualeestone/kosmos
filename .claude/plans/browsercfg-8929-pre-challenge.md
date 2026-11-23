---
pre_challenge: true
method: challenge-loop
branch: browsercfg-8929
diff_hash: 7fc734605fbcd67c10adcc54314393e7fad75ec5591ed0ae45765a3bd8ba7e12
validation: passed
subdir_audit: passed
timestamp: 2026-11-23T11:45:49Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10 (after two earlier blind reviews recorded in the plan)
**Converged:** Yes (iteration 10: zero NEW findings after deduplication, no ASKED findings)
**Total findings:** 31 (0 BLOCKERs, 29 WARNINGs, 2 CONVENTIONs noted as satisfied, NITs listed below)
**Fixed:** 16 | **Deferred:** 15 | **Asked (awaiting user):** 0

Initial validation (6.0): the commands passed but the helper recorded the run superseded because iteration 1 committed while it ran (kosmos#6126). Each iteration ran agentbrowser.test.js under tools/run-tests.sh --only; closing validation (6j) passed on 29cb746893 (node part 30,687 tests, 0 fail; shell part green).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/agentbrowser.js:222: the #8929 block detached launchConfig's doc comment --> FIXED (5a56c8224b)
- [WARNING] engine/agentbrowser.js:241: kt rule case-insensitive and wider than the machine-wide rule --> FIXED (5a56c8224b, now exactly _KOSMOS_KT_RE)
- [WARNING] engine/agentbrowser.js:246: catch around live-execution fails open --> DEFERRED: fails toward the old behaviour (write); stated as the weakest premise
- [WARNING] engine/agentbrowser.test.js:206: shim arm Mac only --> DEFERRED: honest skip; the pure arm covers the rule

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/agentbrowser.test.js:207: writing control arms could rewrite the LIVE config from an installed layout --> FIXED (37e46a8ff6, pre-check that the runners folder resolves into the test HOME)
- [WARNING] engine/agentbrowser.js:221: testRunMarked re-derived store.isTestProcess --> FIXED (37e46a8ff6, store rule reused; store-only arm added; mutation red)
- [WARNING] .claude/plans: ensureInstalled/ensureShell and minimal-env child uncovered --> DEFERRED: card stays open, "Addresses" not "Fixes"
- [NIT] Windows Temp arm speculative --> taken (removed)

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs (1 duplicate), 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above (the "either separator" comment)
- [WARNING] engine/agentbrowser.js:221: comment claimed "either separator" for a shape that cannot occur --> FIXED (bc670d5904, claim deleted, regex = _KOSMOS_KT_RE)
- [WARNING] engine/agentbrowser.js:233: comment silent on the uncovered minimal-env shape --> FIXED (bc670d5904)
- duplicate of iteration 1: silent null under tmp/kt<n> --> DEFERRED (same reasoning; a stderr line would print in every unsandboxed test run)

#### Iteration 4
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/agentbrowser.js:224: run root under a custom TMPDIR not caught, not named --> FIXED (bfa36fe12e, named in the comment)
- [NIT] plan's earlier design sections stale --> taken (marked SUPERSEDED)

#### Iteration 5
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs (2 duplicates), 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (the kickInstall sentence)
- [WARNING] engine/agentbrowser.js:219: unchecked claim about kickInstall's guard --> FIXED (ceb4abc9c3, deleted)
- [WARNING] engine/agentbrowser.test.js:206: pre-check skipped silently --> FIXED (ceb4abc9c3, now fails before any arm)
- [WARNING] Windows rests on the store's rule alone --> DEFERRED: no behaviour change; recorded

#### Iteration 6
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING (+1 duplicate), 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/agentbrowser.js:233: caller-env arm unreachable and untestable --> FIXED (ba78305984, deleted; no longer exported)
- [NIT] shim arms without a status check --> taken (ba78305984)

#### Iteration 7
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs (+1 duplicate), 1 CONVENTION (plan exists), 5 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/agentbrowser.js:211: comment said "the config is written", launchConfig only --> FIXED (5981c3ddc6)
- [WARNING] other callers may now get null --> DEFERRED after checking: all 14 test files naming launchConfig or the shim pass (346 pass, 0 fail); all supervisor shell tests pass

#### Iteration 8
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING (+2 duplicates), 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/agentbrowser.test.js:206: no arm pins a node --test child with NODE_TEST_CONTEXT only --> FIXED (de05043bbf, arm added; mutation of the store rule turns exactly it red)
- [NIT] managedRoot fallback wording --> taken

#### Iteration 9
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs (+2 duplicates), 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/agentbrowser.js:212: "sandboxed" where any override folder counts --> FIXED (70c1c1c568)
- [WARNING] engine/agentbrowser.js:233: store load on every Mac launch --> DEFERRED, measured: under 1 ms against a 30 ms shim
- While checking: the live config was rewritten by a hand run of tools/test-supervisor-wait.sh; seven supervisor tests now export KOSMOS_AGENT_BROWSER=off --> FIXED (70c1c1c568), all seven pass

#### Iteration 10
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs after deduplication and checked deferral, 1 CONVENTION (plan exists), 5 NITs
**Self-generated:** 0 of the above
- [WARNING] other scripts that name the supervisor lack the switch --> DEFERRED after reading each: none runs the real supervisor against the real runners folder (stubs, a plist string, an installed sandbox, Linux)
- duplicate: minimal-env child, ensureInstalled/ensureShell --> DEFERRED (weakest premise)
**Converged**: no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/agentbrowser.js:222 | BRANCH | block detached launchConfig's doc comment | FIXED | 5a56c8224b |
| 2 | 1 | WARNING | engine/agentbrowser.js:241 | BRANCH | kt rule wider than machine-wide rule | FIXED | 5a56c8224b |
| 3 | 1 | WARNING | engine/agentbrowser.js:246 | BRANCH | catch fails open | DEFERRED | old behaviour; weakest premise |
| 4 | 1 | WARNING | engine/agentbrowser.test.js:206 | BRANCH | shim arm Mac only | DEFERRED | honest skip |
| 5 | 2 | WARNING | engine/agentbrowser.test.js:207 | BRANCH | writing arms could hit the live config | FIXED | 37e46a8ff6 |
| 6 | 2 | WARNING | engine/agentbrowser.js:221 | BRANCH | re-derived store.isTestProcess | FIXED | 37e46a8ff6 |
| 7 | 2 | WARNING | .claude/plans | BRANCH | other writers uncovered | DEFERRED | card stays open |
| 8 | 3 | WARNING | engine/agentbrowser.js:221 | SELF | "either separator" claim | FIXED | bc670d5904 |
| 9 | 3 | WARNING | engine/agentbrowser.js:233 | BRANCH | uncovered shape not named | FIXED | bc670d5904 |
| 10 | 4 | WARNING | engine/agentbrowser.js:224 | BRANCH | custom TMPDIR run root not named | FIXED | bfa36fe12e |
| 11 | 5 | WARNING | engine/agentbrowser.js:219 | SELF | kickInstall claim | FIXED | ceb4abc9c3 |
| 12 | 5 | WARNING | engine/agentbrowser.test.js:206 | BRANCH | pre-check skipped silently | FIXED | ceb4abc9c3 |
| 13 | 5 | WARNING | engine/agentbrowser.js:222 | BRANCH | Windows rests on store rule | DEFERRED | no behaviour change |
| 14 | 6 | WARNING | engine/agentbrowser.js:233 | BRANCH | caller-env arm unreachable | FIXED | ba78305984 |
| 15 | 7 | WARNING | engine/agentbrowser.js:211 | BRANCH | "config is written" overstated | FIXED | 5981c3ddc6 |
| 16 | 7 | WARNING | engine/agentbrowser.js:251 | BRANCH | other callers may get null | DEFERRED | measured: all pass |
| 17 | 8 | WARNING | engine/agentbrowser.test.js:206 | BRANCH | NODE_TEST_CONTEXT-only arm missing | FIXED | de05043bbf |
| 18 | 9 | WARNING | engine/agentbrowser.js:212 | BRANCH | "sandboxed" wording | FIXED | 70c1c1c568 |
| 19 | 9 | WARNING | engine/agentbrowser.js:233 | BRANCH | store load per launch | DEFERRED | under 1 ms |
| 20 | 9 | WARNING | tools/test-supervisor-*.sh | BRANCH | hand-run tests rewrite the live config | FIXED | 70c1c1c568 |
| 21 | 10 | WARNING | tools/*.sh | BRANCH | other scripts lack the switch | DEFERRED | read each: none reaches it |

### NITs (non-blocking, across all iterations)
- [NIT] host-flavoured path functions in the pure test (iteration 1)
- [NIT] both #8929 tests lean on earlier tests' fixtures, asserted (iterations 4, 6, 10)
- [NIT] plainTmp under /tmp is left behind only if the watchdog kills the run (iteration 8)
- [NIT] inKtRunRoot exported for tests only (iterations 6, 8, 10)
- [NIT] shim test asserts this CPU's fake shell; an Intel Mac would fail at fixture setup (iteration 10)

### Strengths (across all iterations)
- Reuses store.isTestProcess and the machine-wide _KOSMOS_KT_RE rather than new rules (iterations 3, 6, 7, 8, 9, 10)
- The shim test runs the path the bug took, one arm per rule with its own mutation, writing controls, and a pre-check that it cannot touch a real runners folder (iterations 4, 8, 10)
- A real board's launch is unchanged and launchConfig still never throws (iterations 1, 3, 10)
