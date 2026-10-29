---
pre_challenge: true
method: challenge-loop
branch: flake-7556
diff_hash: 3703b35fdfcab48431122166c5f2f1b2a640f031e7a99ef573c32fbde84958ac
timestamp: 2026-10-29T08:43:18Z
iterations: 2
converged: true
---

## Challenge loop: 2 blind review rounds, converged

Ledger: `.claude/plans/flake-7556.md`.

#### Iteration 1 (on d17b15b10b): 0 BLOCKER, 0 MAJOR, 3 MINOR
- Fixed: the same sleep-then-kill -0 race was in arms 22, 23, 27 and 29 too; one gone() helper now serves all six
  sites. Fixed: an empty pid passed vacuously; gone() refuses it.
- Decided: no Z-state parsing (the wait is paid only on a failure path).

#### Iteration 2 (on eb0cd7721b): 0 BLOCKER, 0 MAJOR, 0 MINOR, converged
- Every replaced condition keeps its meaning; no removed sleep was a wait anything else needed.

### Final Ledger
- tools/test-site-autodeploy-5589.sh: 112/112 (71 s). Mutation (the deploy script's orphan stop removed): red on arms
  28 and 32. gone() checked directly: an empty pid and a live process are not gone; a killed process is.
- Neither 0.7.74 red was reproduced on this Mac (1 run plus 6 concurrent, unpatched); the cut's isolated re-run was green.
