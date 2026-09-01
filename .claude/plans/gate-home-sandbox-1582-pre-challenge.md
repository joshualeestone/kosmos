---
pre_challenge: true
method: challenge-loop
branch: gate-home-sandbox-1582
diff_hash: 8938688dcdec87191b41d0d03d93ad4fca73a96d560623509aaf1b039b2ffcf2
validation: passed
subdir_audit: passed
timestamp: 2026-09-01T13:55:28Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** Yes (iteration 1 found zero NEW BLOCKER/WARNING/CONVENTION requiring a fix)
**Total findings:** 0 BLOCKER, 1 WARNING (out-of-scope, deferred), 0 CONVENTION, 2 NITs + 6 STRENGTHs
**Fixed:** 2 NITs | **Deferred:** 1 WARNING + 1 NIT | **Asked:** 0

Full suite `bash tools/run-tests.sh` -> 3463/3463. This is the PREVENT half of kosmos#1582:
`test-install.sh` now exports `AGENT_WORKFORCE_HOME="$SB/home"` alongside `KOSMOS_HOME`,
so the install gate's report-hook wiring targets the sandbox settings.json and stops
writing an ephemeral temp hook path into the real shared `~/.claude/settings.json`. The
REPAIR half (rewriting the entries already poisoned) was carded as #1739 and applied
operationally with a backup; this PR is the recurrence-prevention.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKER, 1 WARNING, 0 CONVENTION, 2 NITs
- [WARNING] install/setup.sh:2972 -- the permission-acceptance block writes the real `$HOME/.claude/settings.json` via shell `$HOME`, which `AGENT_WORKFORCE_HOME` does not cover; so the gate's sandbox is scoped, not total. --> DEFERRED: pre-existing, out of #1582's scope, and effectively benign -- it merges a stable boolean (`skipDangerousModePermissionPrompt: true`), never an ephemeral path, so it cannot cause #1582-style poisoning, and it exits before writing whenever the flag is already set (always, on a working agent box). The reviewer explicitly said not to fix it in this PR. Recorded so the team knows the sandbox is scoped.
- [NIT] engine/gate-home-sandbox-1582.test.js -- the source-assert required exact adjacency of KOSMOS_HOME and AGENT_WORKFORCE_HOME. --> FIXED (03db4c10): matches `AGENT_WORKFORCE_HOME="$SB/home"` on any export line (order-tolerant, still red-capable on a revert).
- [NIT] engine/gate-home-sandbox-1582.test.js -- test 1 leaked its mkdtemp dir. --> FIXED (03db4c10): removed in a finally. (The wiringTargets() replication of setup.sh's inline list logic is DEFERRED -- an acknowledged tradeoff; the list lives in a heredoc-embedded node block and the source-assert covers delivery.)
**Converged** -- no NEW actionable findings; 6 STRENGTHs confirming the fix is the correct minimal root-cause change.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | install/setup.sh:2972 | pre-existing benign real-$HOME permission write; sandbox is scoped not total | DEFERRED | out of #1582 scope, cannot cause poisoning (stable boolean, never ephemeral) |
| 2 | 1 | NIT | test source-assert | required exact KOSMOS_HOME/AGENT_WORKFORCE_HOME adjacency | FIXED | 03db4c10 (order-tolerant, red-capable) |
| 3 | 1 | NIT | test 1 | leaked mkdtemp dir | FIXED | 03db4c10 (removed in finally) |

### NITs (deferred)
- wiringTargets() replicates setup.sh's inline target-list logic rather than importing it (heredoc-embedded; acknowledged tradeoff; source-assert covers delivery)

### Strengths (across all iterations)
- Correct, minimal root-cause fix: AGENT_WORKFORCE_HOME (not HOME) is the codebase-wide sandbox convention (homeDir() = AGENT_WORKFORCE_HOME || os.homedir()), so it redirects only the accounts/home resolution the wiring depends on, without repointing everything that reads $HOME; $SB/home matches KOSMOS_HOME
- Complete coverage of the hook-wiring: setup.sh resolves BOTH the default target (accounts.HOME_FOR_TEST = homeDir()) and the non-default targets (accounts.list(), all under homeDir()) through homeDir(), so one env var sandboxes every settings.json the block can write -- including the pre-fix leak into the real non-default .claude-account-* files
- Composes with #1634 and preserves the gate's refused===0: with the sandbox home both the script and the target settings.json are ephemeral, so #1634's guard (scriptEphemeral && settingsDurable) does not fire and the write succeeds -- genuinely complementary, as claimed
- Tests are read-only (no ensureWired/write; list() fails soft on the absent sandbox dir), non-vacuous, and the control is a true equivalent: without the var the default target IS the real ~/.claude/settings.json, so the var is demonstrably the lever
- The consuming code already expected the var: setup.sh's block comment ("AGENT_WORKFORCE_HOME first, for sandboxing", Angel's review) shows the wiring was designed for the gate to set it; test-install.sh simply never did
- Documentation/plan/code consistency: the comment, commit, and plan all describe the same measured root cause, scope the change to accounts/home not $HOME, name the #1634 interaction, and correctly separate the repair (#1739)
