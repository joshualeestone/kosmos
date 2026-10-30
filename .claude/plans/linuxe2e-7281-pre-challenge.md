---
pre_challenge: true
method: challenge-loop
branch: linuxe2e-7281
diff_hash: 4386a261d6e1b72dda1dbf67c1ea8813a387b6d63a646a166fe6b4a8353b8c2a
validation: the workflow parses (ruby YAML); the repo's workflow guards pass (test-ci-created-url-6742, test-ci-gate-armed-2518, test-ci-runner-job-guard-5488, test-ci-runner-route-5488, test-cut-shape-6977, no-name-refs-3071, no-brand-refs-1881, tools.every-test-runs); the workflow itself is dispatch-only and cannot run green until the first staging Linux cut
subdir_audit: passed
timestamp: 2026-10-27T06:00:38Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2: 0 BLOCKERs, 0 WARNINGs, 2 NITs: 1 taken, 1 recorded)
**Fixed:** every WARNING of iteration 1 | **Deferred:** the first real run, until a staging cut publishes the Linux family (it waits on kosmos-relay's tools/build-tunnel-release-linux.sh) | **Asked:** 0

Validation, stated as it happened:
- .github/workflows/linux-family-install-7281.yml parses; every repo test that reads the workflows passes.
- Not run: the workflow (dispatch-only, against the live site; no Linux pointer is served yet, so its first step
  would stop red on purpose). Its assertions were checked against setup.sh and linuxboard.js by both reviewers, and
  the quoting and herestring cases were probed under bash -eo pipefail with a failing control.

The per-round findings and decisions are in .claude/plans/linuxe2e-7281.md.

### Per-Iteration Breakdown

#### Iteration 1
- [WARNING] the site input reached the pointer check but not the installer --> FIXED (KOSMOS_RELEASE_BASE)
- [WARNING] a loose board answering the port would pass --> FIXED (systemd must run it)
- [WARNING] the dead beacon reaching the systemd board was unchecked --> FIXED (unit and /proc environ)
- [NIT] find under pipefail --> FIXED; [NIT] version regex --> FIXED (setup.sh's); [NIT] /run/user and the restore scope --> FIXED

#### Iteration 2
No blockers, no warnings.
- [NIT] the restore scanned the reset PATH --> TAKEN (a list written by the hide step)
- [NIT] a failed user@ start reads as a mkdir error --> RECORDED (same as 4920)

### Final ledger
Converged at iteration 2. Plan: .claude/plans/linuxe2e-7281.md.
