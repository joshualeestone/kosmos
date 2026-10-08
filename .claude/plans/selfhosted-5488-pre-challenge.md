---
pre_challenge: true
method: challenge-loop
branch: selfhosted-5488
diff_hash: a0bb605c39f4d64bb4e72cd61be42d2743e673a8db5214eecc13a88e453b55df
validation: passed (focused, on this head rebased onto main 32ab369a8: test-ci-runner-route-5488 12 ok, test-ci-runner-job-guard-5488 28 ok, test-ci-plans-only-reuse-5488 35 ok, tools.shell-shard-4317 12/12. The rest of the tree is part a's, which passed a full local suite at d0fde2308 (node 16503 tests 0 fail, shell part ran). Merging is INERT by design: routing needs repo variable KOSMOS_CI_RUNNER=on, which is set only after a job passes on the registered runner, so the live validation is that first job, per the plan's live checks)
subdir_audit: passed
timestamp: 2026-10-07T22:36:44Z
iterations: 6
converged: true
---


## [CHALLENGE-LOOP] Summary

**Iterations:** 6, reviewer models alternated (opus, sonnet), each a fresh blind agent
**Converged:** Yes (iteration 6: no BLOCKER, WARNING or CONVENTION in the repo diff; NITs fixed)
**Fixed:** every actionable finding, one commit per iteration ("address challenge-loop iteration N findings")
**Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [BLOCKER] a fork's pull_request runs its OWN test.yml and can name the label, so routing only stops the honest path --> FIXED: the machine's job-started guard (tools/ci-runner-job-guard.sh, installed from main) refuses any job not this repo's own before any step, fails closed, reads the payload with plutil
- [WARNING] the 24-hour queue for an offline runner and one-runner serialization were unstated --> FIXED: stated as costs in the plan
- [NIT] the route test did not use GitHub's own shell flags --> FIXED: --noprofile --norc -eo pipefail

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] the guard trusted a variable naming the event file --> FIXED: reads only the runner's own event file at its fixed path, and the payload must name this repo (18 cases, red-checked)
- [WARNING] setup installed the guard unpinned and emptied the job temp at start (where the payload lives) --> FIXED (setup script, outside the repo): pinned commit + sha256, temp emptied only after a job

#### Iteration 3
**Reviewer model:** opus
- [WARNING] a root-owned guard bought no real boundary (the runner's .env and binaries stay job-writable) --> FIXED: trust model decided and stated (only this repo's code runs on the Mac); the root-owned step dropped
- [WARNING] the guard leaned on HOME and PATH --> FIXED: event path from its own install location, /bin/bash, PATH=/usr/bin:/bin, refuses a linked payload; tested in a scratch home with HOME pointed elsewhere

#### Iteration 4
**Reviewer model:** sonnet
- [WARNING] hooks located the guard by $HOME --> FIXED (setup script): by their own path
- [WARNING] a changed --work or a stray copy of the guard was untested --> FIXED: tests for a stray copy and a symlink from another folder (both refuse), with the real-path allow as control
- [NIT] the job's downloads and the register-from-GUI step were unstated --> FIXED in the plan

#### Iteration 5
**Reviewer model:** opus
- [BLOCKER] a fork PR's payload names this repo as its base, so trusting the event variable alone let a pull_request pass as a push --> FIXED: the guard reads the event TYPE from the payload (push needs ref and pusher, workflow_dispatch its workflow, schedule its schedule); the reviewer's probe is now a test, red-checked
- [WARNING] a symlink AT the runner's own event.json was untested --> FIXED: its own test

#### Iteration 6
**Reviewer model:** sonnet
- [NIT] has() on a null key --> FIXED: reads as absent (fail-closed)
- [NIT] the job-completed hook's RUNNER_TEMP missing from the live checks --> FIXED in the plan
- [NIT] setup ordering and error reporting (outside the repo) --> FIXED: every download and check before the runner stops

### Strengths
- [STRENGTH] the boundary is the machine's guard, not the workflow: a fork that rewrites test.yml still cannot run on the Mac
- [STRENGTH] a kill switch (repo variable) routes nothing until it is set, and turning it off sends every job back to GitHub's Mac
