---
pre_challenge: true
method: challenge-loop
branch: fix-staging-install-cmd-2036
diff_hash: 57443f8c89ee36135a5556c09deea4ee78d5cb9f0e5a4bc79097cbb084f47d09
validation: passed
subdir_audit: passed
timestamp: 2026-09-04T21:32:10Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** Yes (iteration 1: zero BLOCKER/WARNING/CONVENTION)
**Total findings:** 0 BLOCKER, 0 WARNING, 0 CONVENTION, 1 NIT (no action)
**Fixed:** 0 | **Deferred:** 1 | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1 (CONVERGED)
- [NIT] docs/staging-channel.md:26-27 — the doc's parenthetical still contains the wrong-form command string as part of its "what NOT to do" warning. Acceptable: no test greps docs, and it reads clearly as an explanation. --> DEFERRED (a deliberate warning; a future doc-scoped guard, if added, must scope to command lines not prose).
- The reviewer verified: the fix is correct (`curl ... | KOSMOS_UPDATE_CHANNEL=staging sh` puts the var in the sh that runs setup); both new source guards are red-capable and correctly wired; the "check matches its own documentation" trap is avoided (the added release.sh comments do not contain the literal wrong-command string guard 1 greps for — confirmed by direct grep); guard 2's `\|` escaping is shell-correct for ERE.

### Validation
- Full `validation_log_run_or_skip` PASSED clean (hash 3dc28993): JS suite + all test:shell arms including the 2 new hand-off-command guards (test-staging-wire-2036: 24 passed, 0 failed).

### Strengths
- The bug is a shell pipe-precedence error, verified live: `FOO=BAR true | sh` -> UNSET; `true | FOO=BAR sh` -> BAR. The served /setup honors the channel (lines 2236-2237 select latest-staging.json), so the mechanism was fine and only the command was wrong.
- Source guards prevent regression: one FAILS if the var-on-curl form returns, one FAILS if the correct var-on-sh form disappears.
- No em dashes in the diff.
