---
branch: move-steps-win32-6183
method: challenge-loop
diff_hash: abba5c86b901483176cad8595f08c5709cee758aaee33e073d8069dafd2e8ad6
base: 5845b17c1154cd194a5abf13da5fd78047ea53ba
head: 5eb406bd11fc6d47a8d20316f9eaff7444f7a048
validation: passed
subdir_audit: passed
converged: true
iterations: 3
model_rotation: opus / sonnet / opus
---

# Challenge-loop proof -- move-steps-win32-6183 (#6183 Windows half)

## Scope

Windows half of the move-steps-across-machines work (#6183). Mirrors the already-merged
Linux half (PR #6230). Converts the win32 restart and session-end of a Kosmos account move
from blocking sync polls into board-responsive **step generators**, so a long schtasks
`/End`/`/Run` cycle or a taskkill no longer holds the board thread.

Files (per `git diff --stat origin/main...HEAD`, excluding this proof):

- `engine/win32job.js` -- step generators `endSteps`/`startSteps`/`runningSteps`; shared
  parsers `endedOk`/`startedOk`/`idAccepts`; exported `win32StepResult` normalizer;
  `SCHTASKS_TIMEOUT_MS`.
- `engine/win32stop.js` -- `endSteps` (resolve pid [read], one taskkill, shared
  `finishKill`); `TASKKILL_TIMEOUT_MS`; lazy-requires `win32job.win32StepResult`.
- `engine/remove.js` -- `jobOps('win32').steps` + `sessionOps('win32').endSteps`; the sync
  restart now drives steps via `driveSync` so schtasks routes through remove's run().
- `engine/remove.win32-restart-3431.test.js` -- migrated command injection to
  `remove.setRunner` for the restart path.
- `engine/world-guard-lift-1704.test.js` -- 6j-finding fix: `winWorld` installs a
  recording `remove.setRunner`; sync session-kill records into shared `win32Killed`.

## Model rotation

opus (iter 1) / sonnet (iter 2) / opus (iter 3). Each iteration spawned a fresh blind
challenge agent; the orchestrator held the ledger. Convergence is witnessed by both models.

## Ledger (per-iteration)

### Iteration 1 -- opus

- [WARNING] two stale comments in `remove.js` described the pre-migration sync-only restart
  path; they contradicted the new step-driven path. FIXED (rewritten to describe executor
  unification).
- [CONVENTION] `win32stop.js` taskkill had no named timeout constant where `win32job`'s
  schtasks did. FIXED (added `TASKKILL_TIMEOUT_MS`, mirrors `SCHTASKS_TIMEOUT_MS`).

### Iteration 2 -- sonnet

- [BLOCKER] `endSteps`/`startSteps` mutated presence but did not clear `PRESENCE_MEMO`, so a
  second move within the memo window read a stale liveness. FIXED (both call
  `PRESENCE_MEMO.clear()`; `runningSteps` deliberately does not -- it is a read).
- [WARNING] a docblock had detached from its function after the generator split. FIXED
  (reattached).
- [WARNING] `runningSteps` used the `now` seam but left the `sleep` seam's inertness
  unexplained, inviting a future "fix" that wires it. FIXED (comment: the driver answers
  `{sleep}`, the seam is inert by design; first read happens before any sleep).
- [CONVENTION] the executor-unification fact (sync restart now routes schtasks through
  remove's run()) was undocumented at the `remove.js` call site. FIXED (comment added).
- [NIT] the async `{sleep}` path lacked a board-responsive test. FIXED (added a test that
  asserts the generator yields `{sleep}` and stays responsive).
- [CONVENTION] Done-when #3 wording in the plan was ambiguous. FIXED (reworded).

### Iteration 3 -- opus

- 0 blocking findings.
- [NIT] `win32job.running()` is now orphaned -- shadowed by `runningSteps`. DEFERRED to the
  item-7 put-back follow-up (removing it is a non-trivial post-convergence change touching
  a public-ish seam; out of scope for this PR, recorded here and in the plan).

Iteration 3 produced zero NEW blocking/warning/convention findings after deduplication ->
6d CONVERGED.

## Final validation (6j)

The authoritative full-suite 6j ran twice.

1. First 6j (rebased head `ef42f6f4f`) FAILED on `engine/world-guard-lift-1704.test.js`:
   "Windows: restart, remove and restore in a named Kosmos act only on its keyed task and
   its OWN live session." Root cause: the executor migration routed the restart's
   `/End`,`/Run` and session taskkill through remove's run(), breaking the test's command
   recording and throwing at `setDryRun(false)` (no injected remove runner).
2. FIX (committed `5eb406bd1`): `winWorld` installs a `remove.setRunner` recording
   schtasks -> `calls` and taskkill -> module-level `win32Killed`; `windowsSessionsLive`
   records its sync taskkill into the same `win32Killed`. All 12 tests in the file pass.
   Proactive scan: only `remove.win32-restart-3431.test.js` (migrated) and
   `world-guard-lift-1704.test.js` were at risk; `delete-leftover.test.js` is removeInner
   sync, unaffected.
3. Second 6j at `5eb406bd1` PASSED clean: validation-log `status: clean`, hash
   `abba5c86b901...`, base `5845b17c1`, AUDIT_EXIT=0, VALIDATION_EXIT=0, no failing tests.
   Full suite GREEN at the PR head.

## Disclosures against this work

- The orphaned `win32job.running()` NIT ships unfixed (deferred to #6231 item 7, documented
  above and in the plan).
- The async `{sleep}` / sync-control tests use real wall-clock (250ms interval, 25ms block);
  could theoretically flake on an extreme box, passed locally.
- The win32 step path's test-guard is remove's `liveExec`, not win32job's stricter
  `schtasksMayRunInThisProcess` -- a narrow residual shared with the merged Linux half.
