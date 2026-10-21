---
pre_challenge: true
method: challenge-loop
branch: recoverykey3-6609
diff_hash: af79305689ddba47a7bde3ea657a88b94775ed3426e61f3b7bc950a57c93ad30
validation: passed (rebased on origin/main after #6687: all 32 install.*.test.js, engine/manifest-verify.recovery-6609 and engine.reachable, 356 pass; install.recoverykey-setup-6609 runs the real setup.sh functions early, tmux, pre and post; every new guard's mutant measured red)
subdir_audit: passed (no subdirectory CLAUDE.md in the diff)
timestamp: 2026-10-20T10:45:58Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2 raised NITs only)
**Total findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Fixed:** 2 WARNINGs (one as the hard gate beside RECOVERY_KEYS), 3 NITs | **Deferred:** 2 NITs (reasons in the plan) | **Asked (awaiting user):** 0

Reviewer models: opus (iteration 1), sonnet (iteration 2). After convergence the hard gate also names the Windows updater (#6607), comment only.

### Per-Iteration Breakdown (from .claude/plans/recoverykey3-6609.md)
#### Iteration 1 (opus)
- [WARNING] fixed: the rule beside RECOVERY_KEYS said "not before 2b", which this slice meets, so it would stop guarding while the .pkg path and the site are not done. Rewritten as the hard gate (the .pkg helper and 2c); engine.reachable's trustedKeys excuse updated to match.
- [WARNING] recorded as the hard gate: the .pkg pinned path still chooses the installer with the built-in keys (Swift helper). Not changed here (a compiled helper, with the site work in 2c); the plan's weakest premise names it and the path table.
- [NIT] fixed: the plan claimed a list published mid-run is taken; it is not (one fetch per attempt).
- [NIT] fixed: a list caught mid-publish read as an attack in setup.sh; the verifier now adds "it may be mid-publish; try again in a minute".
- [NIT] fixed: the new test now runs post too (a VERSION file the manifest lists). Remaining, failing safe: the http(s) query branch (od/tr) is never run by a test (every case uses file://), and a tmux form that took the list but used KEYS would pass (tmux checks the same manifest early already checked with the list).
#### Iteration 2 (sonnet): converged
- [NIT] accepted: the "may be mid-publish" suffix is added to every list that does not verify, including a structurally bad one; the signing tool checks its own output with verifyKeyList, so such a list is not published.
- [NIT] accepted: the manifest downloads carry no fresh query (their names are versioned and never change; a stale cached one paired with a fresh list fails closed). The query branch is still run by no test (already recorded).
