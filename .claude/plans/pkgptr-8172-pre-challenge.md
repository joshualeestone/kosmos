---
pre_challenge: true
method: challenge-loop
branch: pkgptr-8172
diff_hash: c38291b93675c8c60a7a5837c0f0c386534ba24bb6183de55f63a18a184d5c65
validation: passed
subdir_audit: passed
timestamp: 2026-11-07T07:44:56Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** Yes (iteration 8 found no new BLOCKER, WARNING or CONVENTION; its one WARNING was settled by reading)
**Total findings:** 1 BLOCKER, 18 WARNINGs, 1 CONVENTION, many NITs (counted across rounds, repeats included)
**Fixed:** 1 BLOCKER, 13 WARNINGs and most NITs | **Deferred or decided:** 5 (reasons below and in the plan) | **Asked (awaiting user):** 0

Validation: full suite on Mortals for this exact diff hash (c38291b93675), base adb04c3f71: tests 27839, pass 27396,
fail 0, cancelled 0, entry status clean (2026-11-07T07:44:36Z). Between rounds the changed test files
(test-pkg-channel-8167, test-setup-staging-5032, test-promote-named-7005) were run on each head, and a wider batch of 16
pointer and promote tests passed on the first head. Subdir CLAUDE.md audit: rc 0.

Red-capable, measured: seven deliberate mutations, each against the test meant to catch it, each reverted with the
tree checked: promote copying a pkg the pointer does not name (1 FAIL), verify-served never holding a pkg to its pointer
(2), a staging pointer naming the prod pkg (3), both channels strict (4), the republish compare ignoring pkg_sha256
entirely (1), the malformed-sha sentinel mistyped (1), and the pre-round-1 code itself against the prod-cut case.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above (ITER_COMMITS was empty)
- [BLOCKER] tools/verify-served.sh - a prod cut writes both pkg names but only latest.json, so its own step 9 would red on the staging pkg after deploying --> FIXED (f9c24345d6): strict only for the channel being verified
- [WARNING] tools/promote-channel.sh - an unmoved promote left a state every later staging cut's verify would red on --> FIXED by the same rule
- [WARNING] tools/pointer-freeze.sh - a freeze reds verify on a differing pkg --> DECIDED: intended (the Download button is not the frozen build's)
- [WARNING] tools/publish-staging-pointer.sh - a republish kept a stale pkg_sha256 after a prod cut --> FIXED (f9c24345d6)
- [NIT] x3 --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] tools/promote-channel.sh - the named-promote compare refused a republish that dropped pkg_sha256 --> FIXED (072ae8059e)
- [WARNING] verify-served after a freeze on a staging run --> SETTLED: no cut starts while frozen (kosmos#6620 block)
- [WARNING] x2 promote warning wording --> FIXED (072ae8059e)
- [CONVENTION] tools/release.sh - pointer write always after 3c? --> SETTLED by reading: linear script, 3c at step 3c
- [NIT] KOSMOS_VERIFY_POINTER passed by the cut? --> SETTLED: step 9 passes it

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 7 NITs
**Self-generated:** 0 of the above
- [WARNING] docs/staging-channel.md - said a --version promote never moves Kosmos.pkg --> FIXED (417018ffd6)
- [NIT] x5 --> FIXED; x2 --> DEFERRED (double pointer fetch, absorbed by step 9's retry; literal name in a script that does not load the lib)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] tools/verify-served.sh - an unreadable OTHER-channel pointer failed the run --> FIXED (eced29db76)
- [WARNING] tools/promote-channel.sh - two pointers naming different pkgs passed silently --> FIXED (eced29db76)
- [WARNING] promote publishes a pointer naming an unobtainable pkg --> DECIDED: Josh's word is for the app version; refusing would hold prod back for an installer-only problem
- [NIT] x2 --> FIXED or SETTLED

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] promote's malformed branch untested --> FIXED (26f9f6a5c9), mutation-tested
- [NIT] x4 --> FIXED

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (the duplicated warning string written in iteration 5's fix)
**Duplicates of prior findings:** 1 (the round-4 decision)
- [WARNING] tools/promote-channel.sh - malformed check duplicated across two branches --> FIXED (1835688715): one bash regex
- [NIT] x1 --> FIXED; x2 --> DEFERRED

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (the round-4 wording "the red verify is the alarm")
- [WARNING] the round-4 decision called a red verify the alarm, but nothing runs it after a promote --> FIXED (97d800d9b4): the warning says it is the only signal
- [WARNING] the "neither" warning gave no recovery recipe --> FIXED (97d800d9b4)
- [NIT] x3 --> DEFERRED (reasons in the plan)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Duplicates of prior findings:** 1 (whether a prod cut after an unmoved promote verifies green: SETTLED by reading, a prod cut's 3c makes Kosmos.pkg current, the pointer write reads that triple, and 9c holds the served file to it)
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | tools/verify-served.sh | BRANCH | prod cut's own verify reds on the staging pkg | FIXED | f9c24345d6 |
| 2 | 1 | WARNING | tools/promote-channel.sh | BRANCH | unmoved promote reds later staging verifies | FIXED | f9c24345d6 |
| 3 | 1 | WARNING | tools/pointer-freeze.sh | BRANCH | freeze reds a differing pkg | DEFERRED | intended red |
| 4 | 1 | WARNING | tools/publish-staging-pointer.sh | BRANCH | stale pkg_sha256 kept | FIXED | f9c24345d6 |
| 5 | 2 | WARNING | tools/promote-channel.sh | BRANCH | republish compare refused | FIXED | 072ae8059e |
| 6 | 2 | WARNING | tools/verify-served.sh | BRANCH | freeze on a staging run | DEFERRED | no cut while frozen |
| 7 | 2 | WARNING | tools/promote-channel.sh | SELF | warning wording | FIXED | 072ae8059e |
| 8 | 3 | WARNING | docs/staging-channel.md | BRANCH | doc out of date | FIXED | 417018ffd6 |
| 9 | 4 | WARNING | tools/verify-served.sh | SELF | other-channel pointer missing fails | FIXED | eced29db76 |
| 10 | 4 | WARNING | tools/promote-channel.sh | SELF | different pkgs pass silently | FIXED | eced29db76 |
| 11 | 4 | WARNING | tools/promote-channel.sh | BRANCH | pointer names an unobtainable pkg | DEFERRED | decided, plan round 4 |
| 12 | 5 | WARNING | tools/promote-channel.sh | SELF | malformed branch untested | FIXED | 26f9f6a5c9 |
| 13 | 6 | WARNING | tools/promote-channel.sh | SELF | duplicated malformed check | FIXED | 1835688715 |
| 14 | 7 | WARNING | tools/promote-channel.sh | SELF | "the alarm" never fires | FIXED | 97d800d9b4 |
| 15 | 7 | WARNING | tools/promote-channel.sh | SELF | no recovery recipe | FIXED | 97d800d9b4 |

### Outstanding questions (ASKED, still unresolved when the run ended)
- none

### NITs (non-blocking, across all iterations)
- Deferred, each with its reason in the plan: verify-served's second pointer fetch; publish-staging-pointer.sh's literal name and pkg-bytes-only hash; the unreachable unknown-name arm in verify-served; the dense named-promote compare one-liner.

### Strengths (across all iterations)
- Optional on every writer and reader; a pointer without the field keeps #8167's behaviour exactly (every iteration)
- Strict only for the channel being verified, reported for the other, with paired red and green tests on one fixture (iterations 1, 4, 7, 8)
- A named promote can carry its installer when its pointer names it, guarded by three agreeing shas (iterations 1, 3)
- The cut reads the pkg sha through pkg_triple_check, so a broken triple stops the cut instead of being named (iterations 2, 5, 8)
