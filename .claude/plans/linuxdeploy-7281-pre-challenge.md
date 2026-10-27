---
pre_challenge: true
method: challenge-loop
branch: linuxdeploy-7281
diff_hash: 1e623d389c19a8c31d2860e7e7e9062595919511f4a3fdd4e11431901efc7eeb
validation: focused-passed (tools/test-deploy-linux-7281.sh 44/44); every deploy-site and setup-floor shell test on the committed head 15/15 rc 0 (sweep 3), then every setup-floor-using test after review 3's fix 9/9 rc 0; main has not touched these files since the base; full suite via PR CI
subdir_audit: passed
timestamp: 2026-10-27T06:14:14Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3: 0 BLOCKERs, 1 WARNING fixed, 1 NIT not taken)
**Fixed:** the BLOCKER of iteration 1 and every WARNING of iterations 1-3 | **Deferred:** a post-deploy served check of the Linux pair (recorded) | **Asked:** 0

Validation, stated as it happened:
- tools/test-deploy-linux-7281.sh: 44 checks. The lib against a fake git site and a file:// host, a stand-in curl for
  a cut-off transfer, the setup floor RUN on Linux pointers (Windows-shaped too), and deploy-site.sh's wiring.
- Every deploy-site and setup-floor shell test: sweep 3 on the committed head, 15/15 rc 0. An earlier sweep was
  discarded because I edited the branch while it ran; sweep 2 found the #6826 literal-exit guard, fixed.
- Mutants, each red then reverted from a commit: local bytes unchecked, served .sha256 unchecked, fetched bytes
  unchecked, the name check off, the export check off, the carry unwired, the floor greedy again, a transient read as
  1, the backwards guard off, a temp slot not cleared, a cut-off keeping its status, the arch list loosened, a garbled
  live pointer passing, versioned ignored by the floor.
- Not run: tools/deploy-site.sh itself (it deploys).

After C1's PR CI showed it (01:12): tools.every-test-runs.test.js requires a new tools/test-*.sh in test:shell;
tools/test-deploy-linux-7281.sh added before this PR's node suite could fail on it (guard 27/27).

The per-round findings and decisions are in .claude/plans/linuxdeploy-7281.md.

### Per-Iteration Breakdown

#### Iteration 1
- [BLOCKER] setup-floor.sh's greedy version parse read kosmos-V-linux-x64 as V-linux: every deploy with a Linux pointer refused --> FIXED (and the floor is now run in the test)
- [WARNING] one fetch attempt, any failure exit 1 (autodeploy parked a transient) --> FIXED (retries; 404 = 1, else 75)
- [WARNING] temps in the shared dist/ not cleaned on a signal --> FIXED (deploy-site's trap slots)
- [WARNING] nothing stopped a stale checkout moving a Linux pointer backwards --> FIXED (KOSMOS_LINUX_ROLLBACK to override)
- [WARNING] no post-deploy served check --> RECORDED
- [NIT] .sha256 compared after the download --> FIXED; [NIT] non-atomic writes, mode 0600 --> FIXED

#### Iteration 2
- [WARNING] a cut-off 200 read as 200 --> FIXED (code=000; a live pointer with no version is 75)
- [WARNING] the non-greedy floor accepted -rc-arm64 and -arm64-evil --> FIXED (the published archs listed)
- [WARNING, found by the sweep] deploy-site.sh exits must be literal codes (#6826) --> FIXED
- [NIT] reuse LIVE_PTRS_BEFORE --> RECORDED; [NIT] two 75 branches untested --> RECORDED

#### Iteration 3
No blockers.
- [WARNING] the floor read `artifact` while the Linux code reads `versioned` --> FIXED (versioned preferred when named)
- [NIT] fold the two 200 arms --> NOT TAKEN (deliberately ordered)

### Final ledger
Converged at iteration 3. Plan: .claude/plans/linuxdeploy-7281.md.
