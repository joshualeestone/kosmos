---
pre_challenge: true
method: challenge-loop
branch: linux-ci-4919
diff_hash: ea88d4cfd4183348f1db9939456e82167a49c0440a6ef9efccfd151036fcee49
validation: focused on macOS (1119 pass, 0 fail, 1 existing opt-in skip; every touched test file plus the Windows and file-scanning guards); Linux lane run 37531000100 120 fail, all in files carried by named cards
subdir_audit: not run (no subdirectory CLAUDE.md changed)
timestamp: 2026-10-06T21:26:38Z
iterations: 11
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 11
**Converged:** Yes (iteration 11: NITs only)
**Total findings:** 21 actionable (0 BLOCKERs, 18 WARNINGs, 3 CONVENTIONs), plus NITs
**Fixed:** 16 | **Deferred:** 5 | **Asked (awaiting user):** 0

Takeover of Raiden's PR #4986 (approved 10-02) per Splinter 2026-10-06 15:08. Validation note: the full suite is not queued on the shared Macs for this (Splinter's 09-30 rule); the touched files and guards run on macOS, the PR's CI runs the full macOS and Windows suites, and the Linux lane itself is the Linux evidence.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**Self-generated:** 0
- [WARNING] engine/create.test.js: leftoverJob skip wider than its reason --> FIXED (temp arm only)
- [WARNING] engine/projects.test.js: preview test skipped whole --> FIXED (runs everywhere, asserts what the disk gives)
- [WARNING] .github/workflows/linux.yml: always red with no expected-red record --> FIXED (header names them); known-red list DEFERRED to after B/D
- [CONVENTION] plan: skip-condition sentence overbroad --> FIXED
- NITs fixed: update.js docblock, install/kosmos PATH lsof fallback dropped, unused clock removed, codexsession reason

#### Iteration 2
**Reviewer model:** sonnet
**Self-generated:** 0
- [WARNING] linux.yml: says "the test suite" but runs the node half --> FIXED
- [WARNING] engine/codexsession.test.js: skip wider than premise --> DEFERRED (file not on the Windows job; fixed properly in iteration 4)

#### Iteration 3
**Reviewer model:** opus
**Self-generated:** 1
- [WARNING] engine/create.test.js: skip reason claimed Linux agent jobs are systemd units (#4918 not on main) --> FIXED (reason says what is true today)
- [WARNING] symlink-fixture coverage on Linux --> DEFERRED (launchd path is replaced on Linux, not ported)

#### Iteration 4
**Reviewer model:** sonnet
**Self-generated:** 1
- [WARNING] engine/codexsession.test.js: "only on macOS" overclaims --> FIXED (keyed on its premise: tmpdir reached through a symlink)

#### Iteration 5
**Reviewer model:** opus
**Self-generated:** 0
- [WARNING] engine/create.test.js: two tests skipped as "temp" but need a second spelling of the plist folder --> FIXED (premise-keyed NO_SECOND_SPELLING)
- [WARNING] linux.yml push trigger makes this PR carry a red linux check --> FIXED in the PR description (expected, not required)

#### Iteration 6
**Reviewer model:** sonnet
**Self-generated:** 1
- [WARNING] engine/create.test.js: the second-spelling probe created the plist folder at load --> FIXED (read only)

#### Iteration 7
**Reviewer model:** opus
**Self-generated:** 1
- [WARNING] linux.yml: expected-red globs wider than the measured files --> FIXED (exact files and cards)

#### Iteration 8
**Reviewer model:** sonnet
**Self-generated:** 1
- [WARNING] engine/create.test.js: temp arm dropped silently inside a passing test --> FIXED (own test, visible skip)
- [WARNING] header citations unverified --> DEFERRED: verified (#4920, #5419, #5420 and the run id exist and match)
- [CONVENTION] engine/projects.open-why-1199.test.js: Mac-only reason hid a product gap --> FIXED

#### Iteration 9
**Reviewer model:** opus
**Self-generated:** 1
- [WARNING] tools.heavy-gate-3805.test.js: zsh arm dropped silently --> FIXED (runs both shells, as on main)
- [WARNING] engine/projects.open-why-1199.test.js: gap with no card --> FIXED (names #4916 and why it has none of its own)
- [WARNING] plan: baseline run mislabelled as main --> FIXED
- [WARNING] codexsession symlink fixture --> DEFERRED (duplicate of iterations 2 and 4)

#### Iteration 10
**Reviewer model:** opus
**Self-generated:** 0
- [WARNING] engine/create.test.js: two #4279 checks passed on Linux without reaching their case --> FIXED (one skipped on Linux, one split into its own Linux-skipped test)
- [WARNING] no finished Linux run on the branch's head --> FIXED: run 37531000100 finished; its one unexpected red was a real bug the PR's skip had hidden, filed #5424 and listed, not skipped
- [CONVENTION] update.js docblock and install/kosmos comment inexact --> FIXED

#### Iteration 11
**Reviewer model:** sonnet
**New findings:** NITs only
**Converged.**

### Outstanding questions (ASKED)
None.

### NITs (non-blocking)
- [NIT] caseInsensitiveFS() is copied into three test files (a shared test-support helper would be tidier)
- [NIT] projects.test.js /tmp sibling uses startsWith('/tmp')
- [NIT] heavy-gate's zsh-guarded sibling vs the unguarded loop on a zsh-less host (the lane installs zsh)
- [NIT] tools/test-board-foreground-2956.sh still checks only /usr/sbin/lsof (shell half not on Linux yet)

### Strengths
- GNU-then-BSD stat order is correct on both; the old order printed filesystem info on GNU
- install/kosmos lsof lookup keeps macOS on /usr/sbin/lsof and never trusts PATH
- Linux-only skips are keyed on platform or premise, so macOS and Windows run every test they ran before
- The lane's red is explained file by file, each file carried by a card (#4920, #5419, #5420, #5424)
