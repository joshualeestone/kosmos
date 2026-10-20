---
pre_challenge: true
method: challenge-loop
branch: recoverykey2-6609
diff_hash: 4cab559e18bacbb823023ae1daa7585b8e593746c067860efc2dd33987c916ea
validation: passed (156 focused tests from the worktree root on the rebased tree: install.recoverykey-run-setup-6609 8, install.setup-sig-6468, engine/manifest-verify.recovery-6609, engine.reachable, install.manifest-sig-6468, install.tmux-sig-6473, install.pkg-verify-6576, standing guards, bundle.*; every new guard's mutant measured red)
subdir_audit: passed (no subdirectory CLAUDE.md in the diff)
timestamp: 2026-10-20T09:21:00Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2 raised NITs only)
**Total findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Fixed:** 2 WARNINGs, 1 NIT | **Deferred:** 3 NITs (reasons in the plan) | **Asked (awaiting user):** 0

Reviewer models: opus (iteration 1), sonnet (iteration 2).

### Per-Iteration Breakdown (from .claude/plans/recoverykey2-6609.md)
#### Iteration 1 (opus)
- [WARNING] fixed: a torn or cached list/signature pair, and the "taken meanwhile" race, answered 97 (permanent; the .pkg path does not retry it) when a retry would succeed. Now 96, with a fresh shared query per attempt over http(s); a verified-but-refused list stays 97. Arms: a list from the wrong signer and a torn pair are 96; the https query is on both files and changes per attempt, none on file://; trustedKeys's race result carries retry: true (phase-1 race test). Mutants measured red: the signature failure back to 97 (2), no query (1), different queries (1), a fixed query (1), the retry flag removed (1). Not reachable end to end: runSetup's use of the retry flag (the race needs the phase-1 linkSync stand-in), stated rather than faked.
- [WARNING] fixed: the weakest premise named the wrong mechanism. setup.sh checks with the INSTALLED copy's built-in KEYS, so this slice alone stops nothing. Rule written beside RECOVERY_KEYS and in the plan: not filled in before phase 2b.
- [NIT] recorded for activation: a refused rollback reaches update.js as the generic 97 "could not be checked, try again" sentence; it is an attack signal and deserves its own words when activation is documented.
#### Iteration 2 (sonnet): converged
- [NIT] accepted: a correctly signed but structurally bad list is retried (96) though a retry cannot change it; the signing tool checks its own output with verifyKeyList, so such a list is not published.
- [NIT] fixed: the Validation count (43, not 41).
- [NIT] noted: test 1 alone passes with the list's keys not passed through (RELEASE is also built in); test 4 covers that mutant.
