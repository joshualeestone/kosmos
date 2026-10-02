---
pre_challenge: true
method: challenge-loop
branch: sandboxhome-4909
diff_hash: 5c6996ab512c050996b3b4231c1fa24342381bf875bcb016c5b5e7b94b5a44ce
validation: passed (full tools/run-tests.sh on Mortals at 3d82b92c2, 2026-10-01 21:06 CDT, remote hash equal to the local one); browser-check control on Agent1s (clean vs seeded full browser-check runs, 19:49-21:59): POSITIVE-CONTROL=ok, seeded-only failures render-teamcreate-4557 and render-assistant-bubble-3034 (each passes on this branch's clean per-check homes); the one failure in both arms, mobile-shots-cover-spill, is a known main red fixed by #4893 (14a0b6d6d), not in this branch's base
subdir_audit: not run (the diff changes no subdirectory CLAUDE.md)
timestamp: 2026-10-02T03:11:48Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5 (blind, alternating Opus and Sonnet; full text in .claude/plans/sandboxhome-4909.md)
**Converged:** Yes, at iteration 5 (0 BLOCKER, 0 WARNING, 5 NITs)
**Fixed:** all BLOCKERs and WARNINGs | **Deferred:** 0 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1 (Opus): 1 BLOCKER, 2 WARNING, 3 NIT
- [BLOCKER] the control could never fail: the seed went into the run home, which the fix stops anything reading --> FIXED, seeded into each board's own and each check's fresh home
- [WARNING] the seed failed silently and could leak into a cut --> FIXED, SEEDED RUN banner, missing folder refused
- [WARNING] boards booted after the gated loop started with leaked state --> FIXED
- [NIT] the boot scan accepted the run home --> FIXED

#### Iteration 2 (Sonnet): 0 BLOCKER, 3 WARNING, 5 NIT
- [WARNING] a seed refusal exited before the cleanup trap --> FIXED
- [WARNING] a caller-set home silently disabled the seed --> FIXED, refused
- [WARNING] the runner's seed paths were untested --> ADDED
- [NIT] banner wording, AMBIENT drops the seed var, seed edge cases documented

#### Iteration 3 (Opus): 0 BLOCKER, 2 WARNING, 6 NIT
- [WARNING] a board's seed-copy error went to a log cleanup removes --> FIXED
- [WARNING] a relative seed path resolved after the cd --> FIXED, made absolute first
- [NIT] seed failures counted in the run log; verbatimSymlinks; others kept with reasons

#### Iteration 4 (Sonnet): 0 BLOCKER, 2 WARNING, 4 NIT
- [WARNING] an unenterable seed folder became an unseeded run --> FIXED, refused
- [WARNING] run_one did not know exit 97 (retried, misnamed) --> FIXED

#### Iteration 5 (Opus): 0 BLOCKER, 0 WARNING, 5 NIT. CONVERGED
- [NIT] exit 97 only in a seeded run; CDPATH; others kept
