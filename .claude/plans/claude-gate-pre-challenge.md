---
pre_challenge: true
method: challenge-loop
branch: claude-gate
diff_hash: 63b0c54edd2c03fddefc6bbda2d494027898ea6d654973a073a43818ad3197d8
subdir_audit: passed
timestamp: 2026-08-23T21:45:28Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3's findings were remedy polish on iteration 2's fix, each closed and pinned by tests that execute the emitted remedy lines verbatim; the gate's accept/refuse logic has been stable since iteration 2)
**Total findings:** 8 (1 BLOCKER, 3 WARNINGs, 0 CONVENTIONs, 4 NITs)
**Fixed:** 8 | **Deferred:** 0

### Per-Iteration Breakdown

#### Iteration 1
- [WARNING] the elsewhere arm fired for present-but-unrunnable states, claiming "nothing there" falsely with a remedy that loops on File exists --> FIXED: its own arm, sentence and remedy
- [NIT] no exists-but-not-executable case --> FIXED: broken-symlink fixture

#### Iteration 2
- [BLOCKER] a DIRECTORY at the path passed bare -x and the gate accepted it, completing an install whose agents never start --> FIXED: -f and -x together; directory case pinned
- [WARNING] rm on a directory fails verbatim --> FIXED: rm -r, folder named in the sentence
- [NIT] two round trips when a working claude is on PATH --> FIXED: one-shot replace remedy
- [NIT] assert.fail inside the try --> FIXED: exit-code discipline

#### Iteration 3
- [WARNING] rm -r without -f prompts on a mode-000 file; a declined prompt exits 0 and the one-shot's ln loops --> FIXED: rm -rf both remedies
- [WARNING] the state both remedies CREATE (a symlink) had no accept-arm pin --> FIXED: pinned, plus symlink-to-directory refused
- [NIT] harness lacked set -euo pipefail --> FIXED: matches the shipped shell
- [NIT] symlink-to-directory unpinned --> FIXED

### Strengths (recurring)
- The gate asks the exact question the product asks (binPaths' path and env override), so a which-claude restatement fails the suite
- Every remedy line was executed verbatim in sandboxes including a HOME with a space, and the gate re-run accepted each result
- The two states that look identical from a Terminal produce provably different sentences
- Placement: after the --uninstall dispatch, before any mutation, update-in-place gated too
