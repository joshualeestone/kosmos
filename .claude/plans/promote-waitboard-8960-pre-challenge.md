---
pre_challenge: true
method: challenge-loop
branch: promote-waitboard-8960
diff_hash: 169030fd758f7019db8fec0fa6b8aa09ec1a44539d9cebe1a5165164e60f13a4
validation: passed
subdir_audit: passed
timestamp: 2026-11-24T18:27:20Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No (stopped after iteration 8 under the operator's standing review rule: at most 8 rounds unless a BLOCKER is open; none was)
**Total findings:** 15 actionable (0 BLOCKERs, 14 WARNINGs, 1 CONVENTION), plus NITs
**Fixed:** 13 | **Deferred:** 2 | **Asked (awaiting user):** 0

Final validation (6j) passed on HEAD 3d78a97a17 (validation-log hash 169030fd758f): type-check, lint-fix,
the full test suite (node part and all 4 shell shards green), build; subdir audit clean.

Self-generated column: the 6c-bis blame lookup was NOT run in this loop, so no finding is recorded as SELF
by the lookup. Where a finding was plainly inside an earlier iteration's own fix it says so in words below;
that is a reading, not the mechanical field.

Mutants (by hand, backup copy, mutate, run, restore; not committed): 17 rules mutated, every one turned
test-staging-channel-2036.sh or test-staging-experience-check.sh red.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 6 NITs
- [WARNING] tools/staging-experience-check.sh:140 - no node mapped to exit 1 (nothing answered), so a promote waited its whole limit --> FIXED (4464622)
- [WARNING] tools/promote-channel.sh:538 - wait counted sleep steps, not real time --> FIXED (4464622, SECONDS)
- [NIT] progress line stale for 5 min after the reason changed --> fixed (4464622)
- [NIT] pre-release reported as "later" --> fixed (4464622, rc 2 cannot compare)
- [NIT] untested branches (uncomparable, step 0) --> tests added (4464622)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
- [WARNING] tools/promote-channel.sh:512 - a wrong port or stopped board waited the full 30 min before the gate refused --> FIXED (aee79c7, KOSMOS_PROMOTE_BOARD_SILENT_WAIT 600 s, reset by any answer)
- [WARNING] .claude/plans/promote-waitboard-8960.md:27 - plan claimed committed mutants --> FIXED (aee79c7, plan says by hand)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
- [WARNING] tools/promote-channel.sh - forced rerun on a prod-channel board paid the wait again --> FIXED (3a5397a, HOLD names KOSMOS_PROMOTE_BOARD_WAIT=0); judged inadequate in iteration 6, see there
- [WARNING] tools/staging-experience-check.sh:136 - a 5xx mid-restart ended the wait --> FIXED (3a5397a, 5xx is exit 1)
- Also from the 6g validation of iteration 2: [BLOCKER] the full suite was red on the new no-node test, because the suite exports NODE (inside iteration 1's own test) --> FIXED (3a5397a, NODE= in the test)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Duplicates of prior findings (confirmed resolved):** 0
- [WARNING] tools/test-staging-channel-2036.sh - silent-reset case had no timing headroom (inside iteration 2's own test) --> FIXED (334a9c3)
- [WARNING] tools/promote-channel.sh - persistent 5xx costs 10 min before the refusal, undocumented --> FIXED (334a9c3, header and docs)
- [WARNING] tools/promote-channel.sh - unquoted $cmd breaks on a path with spaces --> DEFERRED: same pattern as the existing GATE_CMD, fails toward no wait

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 6 NITs
**Duplicates of prior findings:** 1 (the --force wait, matched iteration 3)
- [WARNING] tools/promote-channel.sh:542 - one cannot-tell look right after a silence ended the wait --> FIXED (1e7c82d, counted as part of the silence)
- [NIT] sleep could overshoot the silent limit; if/else for sleep; header 5xx; test env isolation --> fixed (1e7c82d)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING (a re-raise judged as an inadequate earlier fix), 0 CONVENTIONs, 4 NITs
- [WARNING] tools/promote-channel.sh:514 - --force still paid 30 min on a board that never takes V (raised in iterations 3, 5, 6 by two models) --> FIXED (2074572, default 600 s with --force; docs say a prod-channel board wants 0; /api/version reports no channel, so the wait cannot tell on its own)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 7 NITs
- [WARNING] tools/test-staging-channel-2036.sh:328 - "(0s of" assertions flake across a second boundary (inside iteration 6's own test) --> FIXED (b782710)
- [WARNING] tools/promote-channel.sh:529 - a custom reader can hang the promote --> FIXED (b782710, header states the reader contract: [port] last, exits 0/1/2, must bound itself)
- [NIT] sibling suites inherit a caller's exported reader --> fixed (b782710); a run with a hostile export showed test-staging-channel-2036.sh itself was exposed before the unset moved to its top (measured)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 3 NITs
**Duplicates of prior findings:** 1 (custom reader hang, matched iteration 7)
- [WARNING] tools/promote-channel.sh:545 - silent-limit stop said "nothing has answered" after cannot-tell looks (inside iteration 5's own fix) --> FIXED (3d78a97)
- [WARNING] tools/staging-experience-check.sh:141 - a 403 not after a silence is not waited for --> DEFERRED: the board token survives installs, so a 403 is a token refusal, not a starting board; it fails toward the gate deciding
- [CONVENTION] docs/staging-channel.md:58 - paragraph not wrapped --> FIXED (3d78a97)
**Stopped here:** round 8 of the operator's 8-round cap, no BLOCKER open.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | tools/staging-experience-check.sh:140 | BRANCH | no node read as nothing answered | FIXED | 4464622 |
| 2 | 1 | WARNING | tools/promote-channel.sh:538 | BRANCH | wait counted sleeps, not time | FIXED | 4464622 |
| 3 | 2 | WARNING | tools/promote-channel.sh:512 | BRANCH | wrong port waited 30 min | FIXED | aee79c7 |
| 4 | 2 | WARNING | .claude/plans/promote-waitboard-8960.md:27 | BRANCH | plan claimed committed mutants | FIXED | aee79c7 |
| 5 | 3 | WARNING | tools/promote-channel.sh | BRANCH | forced rerun paid the wait again | FIXED | 3a5397a, then 2074572 |
| 6 | 3 | WARNING | tools/staging-experience-check.sh:136 | BRANCH | 5xx ended the wait | FIXED | 3a5397a |
| 7 | 3 | BLOCKER | final-validation: test-staging-experience-check.sh | BRANCH | suite exports NODE, no-node test red | FIXED | 3a5397a |
| 8 | 4 | WARNING | tools/test-staging-channel-2036.sh | BRANCH | silent-reset timing headroom | FIXED | 334a9c3 |
| 9 | 4 | WARNING | tools/promote-channel.sh | BRANCH | 5xx stall undocumented | FIXED | 334a9c3 |
| 10 | 4 | WARNING | tools/promote-channel.sh | BRANCH | unquoted $cmd | DEFERRED | same as GATE_CMD, fails to no wait |
| 11 | 5 | WARNING | tools/promote-channel.sh:542 | BRANCH | cannot-tell after silence ended wait | FIXED | 1e7c82d |
| 12 | 7 | WARNING | tools/test-staging-channel-2036.sh:328 | BRANCH | second-boundary flake | FIXED | b782710 |
| 13 | 7 | WARNING | tools/promote-channel.sh:529 | BRANCH | custom reader unbounded | FIXED | b782710 (contract documented) |
| 14 | 8 | WARNING | tools/promote-channel.sh:545 | BRANCH | silent-stop message wrong cause | FIXED | 3d78a97 |
| 15 | 8 | WARNING | tools/staging-experience-check.sh:141 | BRANCH | 403 not waited for | DEFERRED | token refusal, gate decides |
| 16 | 8 | CONVENTION | docs/staging-channel.md:58 | BRANCH | unwrapped paragraph | FIXED | 3d78a97 |

### NITs (non-blocking, across all iterations)
- Port 19998 assumed free in test-staging-experience-check.sh (iterations 1, 4, 5, 6; the existing test makes the same assumption)
- --print-version is recognised only as the first argument (iteration 7)
- The wait widens the window in which a staging publish makes the promote refuse (iteration 7; safe, nothing written)
- version_older lets a trailing dot through (iterations 2, 4, 7, 8; unreachable from the reader's pattern)
- Reader stderr is discarded on the no-wait arms (iteration 2)

### Strengths (across all iterations)
- One version reader (read_board_version) shared by the gate and --print-version, so the wait cannot disagree with the gate (every iteration)
- No gate loosened: exit 1 still refuses after the wait, even with --force, tested (every iteration)
- The no-nonce claim has a control that shows the nonce log records a full-gate mint (iterations 1, 3, 6, 7)
- 9.9.10 against 9.9.9 proves the comparison is numeric (iterations 1, 3)
