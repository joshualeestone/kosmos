---
pre_challenge: true
method: challenge-loop
branch: relaunch-retrust-2808
diff_hash: 155c43b9f1669d330cbea2c467219f1a1d51486fde1917f003904ba44ec3f427
validation: passed
subdir_audit: passed
timestamp: 2026-09-14T23:07:47Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (blind reviewers), plus a clean 6.0 baseline
**Converged:** Yes - iteration 2 found 0 NEW BLOCKER/WARNING/CONVENTION requiring a code change (its
WARNING + CONVENTION are deferred with reasoning below)
**Total findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 2 NITs (+ many STRENGTHs)
**Fixed:** 2 WARNING(iter-1 + the 6g gate) + 2 NIT | **Deferred:** 1 WARNING + 1 CONVENTION | **Asked:** 0

Model coverage (kosmos#2032): sonnet (iter 1) + opus (iter 2).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 (first reviewer pass)
- [WARNING] test key derived with fs.realpathSync, not .native/canonicalOnDisk (passes only on
  case-stable fixtures - the two-derivations defect) --> FIXED (8ba817f2: both tests now use
  require('./trust').canonicalOnDisk + the #2281 separator-normalise).
- [NIT] plan said create.js writes "ONCE at CREATE" - it also writes on the account-flip path -->
  FIXED (8ba817f2: reworded).
- [NIT] supervisor comment claimed "same posture" as the codex-dismiss shim but added a [ -n "$_eng" ]
  guard --> FIXED (8ba817f2: comment now explains why the extra guard is correct).

Plus a 6g gate finding (synthetic, BRANCH): test-zsh-tied-names.sh flagged `const path=require("path")`
inside the shell test's node -e (the `path=` matches the zsh PATH-tied-name pattern the guard scans .sh
for) --> FIXED (dd4bf1a5: renamed the JS var to nodePath). 6g then PASSED.

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 0 NITs
**Self-generated:** 0
**Converged** - no new finding requires a code change. Reviewer independently verified the shim args
mirror create.js exactly, the supervisor wiring is CLAUDE-arm-only + in-scope + before new-session +
best-effort, the write target cannot diverge from the launch account, both tests are end-to-end +
non-vacuous + leak-proof, coverage/wiring/frozen-roots are clean, and no em dashes.
- [WARNING] concurrent-restart lost-update race on the shared default-account config (trust.js's
  read-modify-write has no inter-process lock; a mass KeepAlive reboot restarts many default-account
  agents at once) --> DEFERRED. It is bounded, self-healing (write-free in steady state - a folder
  create.js already set true short-circuits at existing[KEY]===true; a lost write re-lands on the next
  launch), and PRE-EXISTING in trust.js's write mechanism (create.js shares it). The proper fix is
  inter-process locking in trust.js, which also governs create.js's path - a separate, larger change
  out of this PR's scope. This fix is strictly better than the status quo (today EVERY restart
  re-prompts; after it, only a rare concurrent-window collision transiently re-prompts ONE agent on
  ONE launch, then self-heals). Follow-up flagged on #2808.
- [CONVENTION] plan filename is <branch>.md, not the <branch>-<timestamp>.md the docs prescribe -->
  DEFERRED. <branch>.md is exactly what the pre-challenge-gate hook requires (and what merged
  successfully earlier today); adding a timestamp risks the gate not finding it. Cosmetic against the
  documented format only.

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | ensure-launch-trust.test.js | SELF | key via realpathSync not .native | FIXED | 8ba817f2 |
| 2 | 1 | NIT | plan | SELF | "ONCE at CREATE" imprecise | FIXED | 8ba817f2 |
| 3 | 1 | NIT | agent-supervisor.sh | SELF | "same posture" comment | FIXED | 8ba817f2 |
| 4 | 1 | WARNING | test-supervisor-retrust-2808.sh | SELF | zsh-tied `path=` in node -e (6g gate) | FIXED | dd4bf1a5 |
| 5 | 2 | WARNING | trust.js write path | BRANCH | concurrent-restart lost-update race | DEFERRED | pre-existing, bounded, self-healing; follow-up |
| 6 | 2 | CONVENTION | plan filename | SELF | no -timestamp suffix | DEFERRED | <branch>.md is gate-required |

### Outstanding questions (ASKED)
None.

### Strengths (across iterations)
- Shim args are an exact mirror of create.js's Claude create-time call (verified against create.js:4244/4266) - no divergent derivation.
- Supervisor wiring: CLAUDE arm only, $_eng/$NODE_BIN in scope, before new-session (no race), fully best-effort (a re-trust failure never blocks a launch).
- Write target cannot diverge from the launch account (same CLAUDE_CONFIG_DIR read in one invocation).
- Tests end-to-end + non-vacuous (real CONTROLs) + leak-proof (all three roots sandboxed; env -u the real CLAUDE_CONFIG_DIR/CODEX_HOME); project key derived via trust.js's own canonicalOnDisk.
- Wiring/coverage complete: shell test in test:shell, engine test in the runner glob + coverage assertion, frozen-roots clean, no em dashes, no zsh-tied names.
