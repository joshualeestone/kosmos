---
pre_challenge: true
method: challenge-loop
branch: move-steps-winlinux-6183
diff_hash: a0cfc9c74a81b6f3ffb27cf9da27870727d3cb888272ae73859e1dcd9702ae1c
validation: passed
subdir_audit: passed
timestamp: 2026-10-15T13:40:47Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7
**Converged:** Yes (iteration 7 produced zero NEW BLOCKER/WARNING/CONVENTION findings; no unresolved ASKED findings)
**Reviewer models:** alternated opus / sonnet across the 7 iterations (opus, sonnet, opus, sonnet, opus, sonnet, opus), so convergence is witnessed by both models (kosmos#2032).
**Total findings:** 0 BLOCKERs, 6 WARNINGs, 4 CONVENTIONs, plus NITs/STRENGTHs below.
**Fixed:** all 6 WARNINGs and all 4 CONVENTIONs. **Deferred:** 2 NITs (reasoning below). **Asked (awaiting user):** 0.

The change gives the Linux account-move restart acts async "step generator" twins (engine/linuxjob.js), wired into the existing async driver (engine/remove.js jobOps('linux').steps), so a Linux account move's restarts run off the board's thread (execFile + timers) instead of freezing the board once per agent. The synchronous restart/removal path is unchanged (Done-when 3). Windows is a deliberately separate follow-up PR per the plan; the #6183 card stays open (non-closing).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKER, 0 WARNING, 1 CONVENTION, 3 NITs
**Self-generated:** 0 (first reviewer; no loop commit yet)
- [CONVENTION] engine/linuxjob.js — the 30000 ms systemctl timeout was a raw literal repeated at six new step sites --> FIXED: extracted SYSTEMCTL_TIMEOUT_MS (commit iter1)
- [NIT] engine/linuxjob.js — loadedSteps vs sync loaded use different dry-run mechanisms (addressed later)
- [NIT] engine/linuxjob.js — SANDBOX_REFUSED not frozen (addressed iter3/iter6)
- [NIT] engine/remove.js — async diagnose/statusSteps unproven by a test (addressed iter4/iter5 parity)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKER, 3 WARNINGs, 1 CONVENTION, NITs
**Self-generated:** 0 (findings on original branch code)
- [WARNING] engine/remove.js — the steps.loaded comment claimed a DRY_RUN short-circuit the step does not do --> FIXED: corrected the comment (commit iter2)
- [WARNING] engine/linuxwiring-4918.test.js — the async maxGap assertion could not distinguish inline from async (4x25ms < threshold) --> FIXED (strengthened iter2, later replaced by a deterministic routing proof iter4)
- [WARNING] engine/linuxwiring-4918.test.js — only the all-succeed path was covered (sandbox gate, dry-run flag, failed reload untested) --> FIXED: added three generator tests (commit iter2)
- [CONVENTION] engine/linuxjob.js — the systemctl exec arg lists were duplicated between sync and step forms --> FIXED: added the userctl(...) arg builder (commit iter2)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKER, 0 WARNING, 1 CONVENTION, 3 NITs
**Self-generated:** 1 (the SYSTEMCTL_TIMEOUT_MS comment this loop added in iter1)
- [CONVENTION] engine/linuxjob.js (SELF) — the SYSTEMCTL_TIMEOUT_MS comment claimed "every systemctl --user call" while remove.js's via carried its own raw 30000 --> FIXED by making the claim TRUE: exported the constant, routed remove.js's via through it, narrowed the comment (commit iter3)
- [NIT] SANDBOX_REFUSED not frozen --> FIXED (Object.freeze, iter3)
- [NIT] the maxGap<50 threshold could flake on the shared box --> FIXED (dropped it iter4 for the routing proof)
- [NIT] userctl half-applied (deferred then fixed iter5)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKER, 2 WARNINGs, 0 CONVENTION, NITs
**Self-generated:** 1 (the remove.js comment this loop reworded in iter3)
- [WARNING] engine/remove.js (SELF) — the reworded steps.loaded comment ("differ only in a test that both dry-runs and injects a runner") was still inaccurate (a sandboxed dry run diverges too) --> FIXED by DELETING the sync-comparison claim, leaving only the step's factual behaviour (commit iter4)
- [WARNING] engine/linuxwiring-4918.test.js — nothing asserted the step twins build the SAME argv as the sync functions (only the verb was checked) --> FIXED: added an argv+timeout parity test that also exercises statusSteps (commit iter4)
- [NIT] the turns assertion was near-vacuous (the injected async runner awaits regardless) --> FIXED: dropped it; the async proof is now the empty sync-runner + exact command sequence (deterministic routing)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKER, 0 WARNING, 1 CONVENTION, NITs
**Self-generated:** 0 (the inline parse was original branch code)
- [CONVENTION] engine/linuxjob.js — loadedSteps/statusSteps re-implemented the is-active/enabled parse inline (byte-for-byte copies of loaded()/status()), and the comment claimed they "share their parsers" --> FIXED: extracted activeOrActivating(r) and statusOf(act,en), shared by both sync and step so the parse cannot drift; applied userctl uniformly; extended the parity test to compare return values (commit iter5)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKER, 1 WARNING, 0 CONVENTION, NITs
**Self-generated:** 0 (the compared comment was original branch code)
- [WARNING] engine/linuxjob.js — the loadedSteps comment still compared the step's dry run to the sync short-circuit ("the way jobOps' sync loaded short-circuits on DRY_RUN"), which the step does not do --> FIXED by DELETING the comparison; no comment now compares the step's dry run to sync's (commit iter6)
- [NIT] SANDBOX_REFUSED was duplicated between runner() and the const --> FIXED: single-sourced the frozen object, runner() returns a fresh copy (commit iter6)
- [NIT] stray block-comment line wrap + an over-broad "exactly the sync path's via run" --> FIXED (commit iter6)
- [NIT] the parity test does not cover stop/startOnly classification drift --> DEFERRED: those verdicts are already single-sourced (stoppedOrNotLoaded, Boolean(.ok)) and used by both sync and step, so there is no drift surface to guard
- [NIT] the dry-run-as-loaded path is not exercised end to end through remove.js's run() --> DEFERRED: the two halves (loadedSteps reads dryRun; run() sets dryRun) are each independently covered; an end-to-end dry-run restart test is disproportionate for a NIT

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKER, 0 WARNING, 0 CONVENTION, 1 NIT
**Self-generated:** 0
**Converged** — no NEW actionable findings.
- [NIT] .claude/plans/move-steps-winlinux-6183.md — the STATUS section said "All 32 pass"; the Linux test file now has 36 --> FIXED: corrected the count (commit "correct the plan's stale Linux test count")

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | CONVENTION | engine/linuxjob.js | BRANCH | 30000 timeout raw literal x6 | FIXED | SYSTEMCTL_TIMEOUT_MS |
| 2 | 2 | WARNING | engine/remove.js | BRANCH | steps.loaded comment claimed a short-circuit the step lacks | FIXED | corrected comment |
| 3 | 2 | WARNING | engine/linuxwiring-4918.test.js | BRANCH | maxGap assertion non-discriminating | FIXED | routing proof (iter4) |
| 4 | 2 | WARNING | engine/linuxwiring-4918.test.js | BRANCH | only all-succeed path tested | FIXED | 3 generator tests |
| 5 | 2 | CONVENTION | engine/linuxjob.js | BRANCH | systemctl arg lists duplicated | FIXED | userctl builder |
| 6 | 3 | CONVENTION | engine/linuxjob.js | SELF | timeout comment over-claimed scope | FIXED | export + via uses it; narrowed |
| 7 | 4 | WARNING | engine/remove.js | SELF | reworded dry-run comment still inaccurate | FIXED | deleted the comparison |
| 8 | 4 | WARNING | engine/linuxwiring-4918.test.js | BRANCH | no argv parity assertion | FIXED | argv+timeout parity test |
| 9 | 5 | CONVENTION | engine/linuxjob.js | BRANCH | loadedSteps/statusSteps parse duplicated inline | FIXED | activeOrActivating/statusOf |
| 10 | 6 | WARNING | engine/linuxjob.js | BRANCH | loadedSteps comment compared step dry run to sync | FIXED | deleted the comparison |

### NITs (non-blocking)
- [NIT] engine/linuxwiring-4918.test.js — parity test does not drive a not-loaded-stop or a failed-start case (DEFERRED: those classifications are single-sourced, no drift surface).
- [NIT] engine/linuxwiring-4918.test.js — the dry-run-as-loaded path is not exercised end to end through remove.js's run() (DEFERRED: both halves independently covered).

### Strengths (across iterations)
- [STRENGTH] Drift is eliminated STRUCTURALLY, not just asserted: sync and step share userctl, SYSTEMCTL_TIMEOUT_MS, activeOrActivating and statusOf, and a single frozen SANDBOX_REFUSED.
- [STRENGTH] The async proof is by deterministic ROUTING (empty sync runner + exact async command sequence + outcome RESTARTED), paired with a sync control proving the sync path holds the board; no flaky wall-clock threshold.
- [STRENGTH] loadedSteps yields is-active BEFORE reading the per-result dryRun flag, so an injected runner always sees the command; pinned by a dedicated test.
- [STRENGTH] The sandbox gate short-circuits before any yield so a sandboxed board emits no real systemctl command; SIGKILL is never used here (removal-path only, out of scope). The sync removal path (removeInner) is untouched.

### Final-validation gate (6j)
The first 6j full-suite run (on the pre-rebase HEAD) reported one failure: `#6206 ... screens found 99, declared 95` in tools.mobile-shots-serviceworker-6206.test.js. This test is unrelated to this change (it touches only the Linux arm) and was a PRE-EXISTING failure on the branch's stale base 0279d48ec: the fix "#6206 guard: count SCREENS by structure" (3da44f356) had already landed on current main. After rebasing the branch onto current origin/main (b7d3591439b, which includes that fix and the merged #6221), the #6206 test passes alone (3/3) and the full-suite 6j recorded a clean PASS (stack=typescript, hash a0cfc9c74a81, base b7d3591439b, no failing tests). The targeted Linux suites (linuxwiring-4918, linuxjob, linux-parity-5445, remove) are green (174 tests).
