---
pre_challenge: true
method: challenge-loop
branch: browser-check-gate-1720
diff_hash: 8dde9f67f7ccece523f167187b5580c62b898bd5f08f17b1a1a54f06e0c29cb2
validation: passed
subdir_audit: passed
timestamp: 2026-09-01T21:34:49Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4 returned zero new BLOCKER/WARNING/CONVENTION)
**Total findings:** 8 (0 BLOCKERs, 5 WARNINGs, 1 CONVENTION, 2 NITs actioned + a few disclosed)
**Fixed:** 7 | **Deferred:** 1 | **Asked (awaiting user):** 0

Change: #1720, a repo-local gate refusing a `web/` change that carries no added/modified
top-level `docs/browser-checks/*.js` assertion, unless a commit has a non-empty
`Browser-check: <reason>` trailer. The lib (726c42eb) pre-existed on the branch; this run
added the red-capable test, wired the test into `test:shell` and the live gate into
`run-tests.sh`, and hardened the lib through four review iterations. The firing-point
decision (branch time, not release time -- a release-time gate is vacuous because the web/
change is already on main) was independently endorsed by Splinter.

Scope note: review was against `origin/main...HEAD` (local `main` is ~40 commits stale, the
shared checkout is dirty and cannot be pulled); the `diff_hash` is computed against local
`main` to match the `pre-challenge-gate` hook, which uses the same base. Validation of
record is `bash tools/run-tests.sh`: 3530/3530.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 3 NITs
- [WARNING] deleting/renaming a docs/browser-checks/ assertion satisfied the gate (false negative in the dangerous direction) --> FIXED (5b4cfd2a: parse `git diff --name-status --no-renames`, count coverage on A/M only)
- [WARNING] fail-soft was silent (checked-clean vs never-ran indistinguishable) --> FIXED (5b4cfd2a: stderr note on the cannot-diff path)
- [CONVENTION] test used `set -u` where siblings use `set -uo pipefail` --> FIXED (5b4cfd2a)
- [NIT] override branch-wide not documented --> FIXED (header note)
- [NIT] override not truly case-insensitive; test label misleading --> FIXED (full case-insensitive regex + test)
- [NIT] real git path untested --> FIXED (seam-free test arm)
- Also caught by the repo's own zsh-tied-names guard: `path` is tied to PATH in zsh; renamed to dstat/dpath.

#### Iteration 2
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
- [WARNING] `for f in $files` relied on word-splitting, which zsh does not do, so under zsh the loop ran once over the blob and false-refused (while the header claimed zsh-safety) --> FIXED (7935550f: `while IFS= read -r f; do ... done <<< "$files"`; added a test arm that runs the lib under real zsh)
- [WARNING] coverage matched the directory docs/browser-checks/*, so a README there passed the gate outside the audit trail --> FIXED (7935550f: narrowed to *.js; test arm reds a non-.js file)
- [NIT] branch-wide override could match a future commit body --> disclosed, documented, no such line on the branch.

#### Iteration 3
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
- [WARNING] `docs/browser-checks/*.js` matched NESTED paths (case `*` spans `/`), so a nested .js the driver never runs counted as coverage (false accept) --> FIXED (db9c3fa2: reject `docs/browser-checks/*/*` first, matching the driver's top-level-only glob; test arm + control red a nested .js)
- [NIT] .js pinning --> documented (matches the driver's glob; broaden in lockstep)
- [NIT] cut-time run near-vacuous --> recorded in the plan (per-PR is the tight enforcement)

#### Iteration 4
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Converged** -- 3 STRENGTHs confirmed every prior fix; the nested-path fix verified correct against the driver.
- [NIT] comment said "ASSERTION" but the gate is file-level (a helper .js also counts) --> FIXED (d50cf8c7: comment now states the file-level granularity honestly)
- [NIT] run-tests.sh uses `$(dirname "$0")` rather than the computed `$REPO` --> DEFERRED: correct under the real entrypoint, consistent with the script's existing REPO logic, no failing input.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | tools/lib/browser-check-gate.sh | delete/rename of an assertion counted as coverage | FIXED | 5b4cfd2a |
| 2 | 1 | WARNING | tools/lib/browser-check-gate.sh | silent fail-soft | FIXED | 5b4cfd2a |
| 3 | 1 | CONVENTION | tools/test-browser-check-gate.sh | set -u vs set -uo pipefail | FIXED | 5b4cfd2a |
| 4 | 2 | WARNING | tools/lib/browser-check-gate.sh | for-loop not zsh-safe (word-split), false-refuse under zsh | FIXED | 7935550f |
| 5 | 2 | WARNING | tools/lib/browser-check-gate.sh | coverage matched the dir, so a README passed the gate | FIXED | 7935550f |
| 6 | 3 | WARNING | tools/lib/browser-check-gate.sh | *.js matched nested paths (false accept) | FIXED | db9c3fa2 |
| 7 | 4 | NIT | tools/lib/browser-check-gate.sh | comment overstated "ASSERTION" vs file-level | FIXED | d50cf8c7 |
| 8 | 4 | NIT | tools/run-tests.sh | $(dirname "$0") vs $REPO | DEFERRED | correct under real wiring; no failing input |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking)
- Branch-wide override (iter 2), .js pinning + cut-time near-vacuity (iter 3), the run-tests.sh $0 path (iter 4, deferred). All disclosed and documented.

### Strengths (across all iterations)
- The while-read loop is genuinely zsh-safe and runs in the current shell (touched_web/touched_bc persist); verified the zsh test arm reds a non-zsh-safe loop (iteration 4).
- `--name-status --no-renames` + A/M-only coverage + nested-path rejection make the gate's coverage exactly what the driver runs, closing the delete, rename-away, README, and nested-.js false-accepts (iterations 1, 3, 4).
- The test is red-capable and non-vacuous across the full status/extension/nesting matrix, with a real control (both a refuse arm and pass arms), a seam-free real-git arm, and a real-zsh arm (iterations 1-4).
- Fail-soft is in the safe direction for a repo-local aid AND emits a stderr note, so a gate that stopped running is distinguishable from a clean pass (iterations 1, 4).
- The firing point is correct: branch-time (a release gate would be vacuous), repo-local radius (not the fleet hook), with an auditable blank-refused override; Splinter-endorsed.
