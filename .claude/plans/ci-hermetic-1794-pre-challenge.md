---
pre_challenge: true
method: challenge-loop
branch: ci-hermetic-1794
diff_hash: 5ec1f40edfa856a0e9509b41e61e5bcc3392a7d02818416947e2eeffe1a850ca
validation: passed
subdir_audit: passed
timestamp: 2026-09-02T04:36:34Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** Yes (the blind pass found one NON-BLOCKING comment defect, fixed; its
substantive review found zero false greens, mutation-verified)
**Total findings:** 1 (0 BLOCKERs, 0 WARNINGs, 1 stale-comment fixed)

Change: kosmos#1794. Make the 24 non-hermetic engine tests CI-safe (hermetic, by arming
EXISTING test seams) and add `.github/workflows/test.yml` -- the first CI agent-workforce has
ever had (origin/main carried zero workflows). All 24 verified on the real macos-latest runner,
which is ground truth; a local two-arm boardless proxy (broken tmux + an os.homedir->tempdir
stub) is the developer-side check.

Validation of record: **the runner suite is GREEN** -- run 33590706044 on this branch reports
`tests 3701, pass 3701, fail 0, skipped 0`. The count ROSE from the first failing run's 3674 and
skipped is absent, which is the anti-false-green proof: a skip-to-green would have DROPPED the
count. The self-professed "skip count" the card asked for resolves to 0 because nothing skips.

Base note: rebased onto origin/main (#1780, e448b3ba); the three-dot diff_hash base is the
merge-base, stable under further main advances.

### The 24, by the seam each under-armed (all pre-existing seams)
- board roster/capture: `status.setPaneSource` / `setPaneCapture` (connect-agent, discover.register,
  create.spoken-name, trust-configdir, remove).
- runner binaries: `AGENT_WORKFORCE_CLAUDE_BIN` (discover.register) and `AGENT_WORKFORCE_CODEX_BIN`
  (spoken-name, register) stubbed -- a clean runner has neither claude nor codex.
- filesystem sandbox: `AGENT_WORKFORCE_HOME` (store.ROOT, via #1780) + `AGENT_WORKFORCE_WORKERS`
  (create.workerDir / the instruction-file read) + a real identity seed (`fleet.install`), so the
  display-name read resolves inside the sandbox instead of the operator's REAL agent (web.task-page).
- node version: pinned to 26 (+ `.nvmrc` + `engines`). node 22's `--test` child drops `--test`
  from execArgv, so `inTestProcess()` self-reports wrong -- live-execution (3). #1025 is a git
  range needing history a shallow checkout truncates -> `fetch-depth: 0`.

### Per-Iteration Breakdown

#### Iteration 1 (fresh blind pass)
- [NIT->FIXED] Stale node-version comment: changing the pin to node 26 left the ci-workflow-835
  base's "pinned to node 22, verified green on node 22" rationale above it, contradicting the
  actual pin -- the stale-comment-lies hazard. Replaced with a concise, correct intro; comment-only,
  no behaviour change.
- [STRENGTH] The reviewer verified, not assumed, that no hermetic fix is a false green: it ran the
  two-arm proxy on all 7 modified files (zero skips), and MUTATION-TESTED web.task-page's identity
  seed -- reseeding `displayName:'Zelda'` reds both target assertions, proving the display name flows
  seed -> projects.describe -> note text through the real path and the capital-A resolution is under test.
- [STRENGTH] remove's madeAgent seam-reset change (null -> empty board) is behaviour-preserving: a
  fixture agent is never actually running, so both give the same answer; the throw/empty-board arms
  the file needs are set per-test after the beforeEach and are intact.
- [STRENGTH] The node-26 pin is real work (measured: the test child's execArgv carries `--test-*`,
  so `inTestProcess()` is genuinely true, single- and multi-file), and CI can go red (run-tests.sh
  `exit $NODE_STATUS`; `engines` is advisory only). No seam leaks (node 26's process-isolation +
  matched beforeEach/afterEach resets).

### Final Ledger
Converged at iteration 1: the substantive review found zero actionable code defects and
mutation-verified the load-bearing assertions; the lone finding was a stale comment, fixed. The
authoritative gate is the green runner (3701/3701, 0 skipped). One follow-up is owed and is NOT a
CI blocker: server.js's #923 chdir resolves raw os.homedir (it passes on the runner, where homedir
is consistent between the board child and the test, but is not fully isolated) -- its own small PR.
