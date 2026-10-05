---
pre_challenge: true
method: challenge-loop
branch: sideturn-5331
diff_hash: 213e182df53b9c83eb005e899bd10ed4f4a954e8d3084578b51814ab32401195
validation: passed (bash scripts: the four tests that exercise tools/queued-heavy.sh on the rebased head 43df5cf9d: test-queued-heavy-4977.sh 85/85, test-light-side-4911.sh, test-browser-gate-cut-claim-1398.sh, test-pw-version-assert.sh; perturbation and watchdog checks in the plan)
subdir_audit: not run (no subdirectory CLAUDE.md in the diff)
timestamp: 2026-10-05T19:05:26Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3: NITs only)
**Total findings:** 0 BLOCKERs, 7 WARNINGs, 0 CONVENTIONs, about 16 NITs
**Fixed:** all 7 WARNINGs | **Deferred:** NITs listed below | **Asked (awaiting user):** 0

Reviewers were told not to run the scripts (they start processes and claims on a shared machine); I ran them. Reviewer
models alternated (opus, sonnet, opus). Self-generated counts were not measured by blame.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** not measured
- [WARNING] tools/test-queued-heavy-4977.sh capper_of could pick a short-lived $(...) subshell --> FIXED (the capper is the child with its own `sleep 7`)
- [WARNING] tools/test-queued-heavy-4977.sh the arm could pass via the 10 s fallback --> FIXED (asserts no "did not stop" line)
- [WARNING] tools/test-queued-heavy-4977.sh EXIT trap killed the watchdog first, then waited unbounded --> FIXED (bounded reaps, watchdog last)
- [WARNING] tools/queued-heavy.sh bare-pid KILL could hit a reused pid --> FIXED (_qh_child parent check)
- [NIT] guards on the test's own KILLs, BG inside $(...), comment wording --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** not measured
- [WARNING] tools/test-queued-heavy-4977.sh watchdog TERM cannot reach a hung foreground command --> FIXED (KILL step stops the file's children and this run's sleeps; limit stated)
- [WARNING] tools/test-queued-heavy-4977.sh watchdog could outlive its file and signal a reused pid --> FIXED (polls its parent every 5 s, ends with it)
- [WARNING] tools/queued-heavy.sh comment overstated the guard --> FIXED
- [NIT] capper killed before its children --> FIXED

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** not measured
- [NIT] unconditional group kill before the child check (pre-existing exposure); reap's final wait after an `ours` refusal; WD ppid check; cleanup pattern not scoped to $S; grandchildren of a non-leader capper; plan says pkill -P --> not changed (latent or wording; no comment churn)
**Converged**: no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | tools/test-queued-heavy-4977.sh | BRANCH | capper_of ambiguity | FIXED | 74fc2f709 |
| 2 | 1 | WARNING | tools/test-queued-heavy-4977.sh | BRANCH | arm passes via fallback | FIXED | 74fc2f709 |
| 3 | 1 | WARNING | tools/test-queued-heavy-4977.sh | BRANCH | EXIT trap order | FIXED | 74fc2f709 |
| 4 | 1 | WARNING | tools/queued-heavy.sh | BRANCH | pid reuse | FIXED | 74fc2f709 |
| 5 | 2 | WARNING | tools/test-queued-heavy-4977.sh | BRANCH | watchdog vs foreground hang | FIXED | 74f330986 |
| 6 | 2 | WARNING | tools/test-queued-heavy-4977.sh | BRANCH | watchdog outlives file | FIXED | 74f330986 |
| 7 | 2 | WARNING | tools/queued-heavy.sh | BRANCH | comment overstated guard | FIXED | 74f330986 |

### NITs (open, non-blocking)
- iteration 3's six notes above

### Strengths (across iterations)
- The teardown can no longer block: KILL by group, by pid while it is our child, then wait only on a dead capper; a capper that lives costs a line, not the queue.
- The #5331 arm reproduces the hang (a non-leader, stopped capper), its control on the old teardown hangs, and removing the pid KILL turns the arm red.
- The test file can no longer hold its runner: a whole-file watchdog, bounded reaps, and the watchdog last in the EXIT trap.
