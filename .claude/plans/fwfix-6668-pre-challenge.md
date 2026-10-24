---
method: challenge-loop
branch: fwfix-6668
diff_hash: 0936bb17b137b56f910d96cf7ea599e8e568660d80c94585ad1a3fd9265c11e0
timestamp: 2026-10-20T21:46:29Z
iterations: 1
converged: true
---

# Challenge-loop proof: fwfix-6668 (kosmos#6668, the stopped-runner arms under yarn test)

The two stopped-runner arms of tools.run-tests-file-timeout-6668.test.js matched node --test by bare name only, so
under `yarn test` (yarn's node wrapper execs node by its full path), as on Mortals, they never found node and failed
at 30 s. The match now mirrors the runner's own rule, a red prints the runner's tree and output, and a new arm runs
the stop behind a yarn-shaped exec wrapper. Test only; tools/run-tests.sh is unchanged.

#### Iteration 1
- Review (orchestrator): the match equals the runner's, candidates() is limited to the runner's own children, no
  test is hollow. NITs only, all FIXED: a per-arm output file (a label, so two TERM arms do not share one); the
  "still running" red also prints the tree and the output; the wrapper single-quotes node's path for sh (a quote
  and a $ round-trip, measured); an after() removes the fixture directory. Converged.

### Final Ledger
- Iterations: 1. The file 17/17 alone and 17/17 under yarn on the final tree; HEAD under yarn red on both arms
  (30048 ms, 30014 ms); the new arm red with the old bare-name match (30086 ms).
- Every test file naming run-tests.sh (33), from the repo root: 1010 tests, 1009 pass, 0 fail, 1 skipped (before the
  NITs, which touch only this file).
- Full suite on this commit: run by the orchestrator. Owner Renet.
