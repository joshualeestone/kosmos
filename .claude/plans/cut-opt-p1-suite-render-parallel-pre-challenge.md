---
pre_challenge: true
method: challenge-loop
branch: cut-opt-p1-suite-render-parallel
diff_hash: a3ad82ca787790e86c41e1bb4c0d61854d2c9418cbb0f4a4723fe0f265a2f14f
validation: passed
subdir_audit: passed
timestamp: 2026-09-11T15:04:24Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (blind reviewer passes; 6.0 initial validation passed clean)
**Converged:** Yes (iteration 3 found zero NEW BLOCKER/WARNING/CONVENTION)
**Total findings:** 8 (1 BLOCKER, 1 WARNING, 1 CONVENTION, 5 NITs)
**Fixed:** 3 | **Deferred:** 5 | **Asked (awaiting user):** 0

Critical cut tooling (`tools/release.sh` gated-steps region), reviewed at high scrutiny.
Reviewer model was varied across iterations (kosmos#2032): opus -> sonnet -> opus, so the
convergence is witnessed by more than one model. All findings classified Origin BRANCH: the
loop's own fix commits (c4c07cc, d2c9dd3) introduced nothing a later pass flagged, so there
was zero self-generation (kosmos#120).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 1 WARNING, 1 NIT
**Self-generated:** 0 of the above (ITER_COMMITS empty on the first review; 6.0 passed clean)
- [BLOCKER] tools/test-cut-parallel-region.sh — the parallel-mode arms did not pin
  KOSMOS_CUT_PARALLEL_MIN_CORES, so on a <8-core host (CI is macos-latest, 3-4 cores) the
  decision returns SERIAL: the "== 3+3b." branch assertion fails (CI red) AND the
  parallel-mode abort proofs silently never run. --> FIXED (commit c4c07cc): pin
  MIN_CORES=1 + MAX_LOAD=5 + FAKE_LOAD=0.1 so the parallel arms take the overlap branch on
  any host.
- [WARNING] tools/release.sh (parallel page gate) — the concurrently-run render checks have
  no #2006-style contention discriminator; a load-induced flake-red would abort the cut like
  a real red, with no rerun to dismiss it. --> DEFERRED: by design. Can only FALSE-ABORT,
  never ship a red (nice lowers suite priority; the page exit code is still captured
  honestly). This is exactly the flake-rate axis the two-axis rule defers to a measurement
  phase before the default is flipped, and is why the feature is opt-in/default-off.
- [NIT] tools/release.sh — a SIGKILL mid-foreground-render orphans the backgrounded nice'd
  yarn test child. --> DEFERRED: parallel-mode-only, correctness-safe (cannot pass a red),
  documented in the plan.

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 1 CONVENTION, 2 NITs
**Self-generated:** 0 of the above (the cited lines blame to the pre-loop base commit, not to
c4c07cc)
**Duplicates of prior findings (confirmed resolved/deferred):** 1 (re-raised the iter-1
render-contention WARNING, adding the I/O-vs-CPU nuance; deferral unchanged)
- [CONVENTION] tools/release.sh — the page-gate invocation (browser-checks.sh) is duplicated
  byte-for-byte between the parallel and serial branches, with only a comment asserting
  equivalence (CLAUDE.md Convention #5's most-shipped defect class). --> FIXED (commit
  d2c9dd3): added a test assertion in test-cut-parallel-region.sh pinning the two invocations
  byte-identical (modulo indent) -- Convention #5's sanctioned "a test that pins duplicates
  equal". Red-capable (drift -> 2 distinct forms -> fail).
- [NIT] tools/lib/cut-load-guard.sh — an all-digit but OVERLONG KOSMOS_CUT_PARALLEL_MIN_CORES
  override passed the digit-only check then WRAPPED in the $((10#...)) arithmetic, a small
  gap in the "every unreadable input -> serial" fail-safe claim. --> FIXED (commit d2c9dd3):
  cap min-cores at 4 digits (9999 cores); 5+ digits folds to the default 8. Unit test added.
- [NIT] tools/release.sh — the serial body sits at column 0 inside its `if`, inconsistent
  with the 2-space-indented parallel branch. --> DEFERRED: kept at column 0 deliberately so
  the serial body is byte-identical to the pre-change original, which is what lets a reviewer
  verify the serial (default) path is unchanged.

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
**Converged** -- no new actionable findings.
- [NIT] tools/release.sh — in parallel mode a genuinely-red suite aborts before the page
  analysis runs `rm -f "$_page_log"`, leaking one temp file (serial mode never creates it on
  a suite-red abort). --> DEFERRED: parallel-mode-only (opt-in), harmless (one temp file on a
  dying cut; TMPDIR is cleared by the OS), cannot affect correctness. A clean fix would touch
  the shared suite-analysis abort paths, where serial has not yet created `_page_log` (a
  `set -u` asymmetry), raising regression risk on the safety-critical gate for no functional
  gain. Same class as the documented SIGKILL-orphan nit.
- [NIT] tools/release.sh / tools/lib/cut-load-guard.sh — `nice -n 19` and the `0.5` load
  factor are inline literals where Convention #1 prefers SCREAMING_CASE constants. -->
  DEFERRED: idiomatic and borderline (the reviewer said so), and the value sits adjacent to
  the doc comment explaining it -- extracting a constant would reduce that locality.

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | tools/test-cut-parallel-region.sh | BRANCH | parallel arms unpinned MIN_CORES -> CI runs serial, assertion fails + proofs not exercised | FIXED | c4c07cc |
| 2 | 1 | WARNING | tools/release.sh | BRANCH | render checks have no #2006 contention discriminator in parallel (CPU via nice; I/O unaddressed) | DEFERRED | by design: opt-in/default-off, flake-rate is the plan's measurement axis; can only false-abort, never ship a red |
| 3 | 1 | NIT | tools/release.sh | BRANCH | SIGKILL orphans the nice'd bg suite | DEFERRED | parallel-only, correctness-safe, documented in plan |
| 4 | 2 | CONVENTION | tools/release.sh | BRANCH | page-gate invocation duplicated across parallel/serial branches | FIXED | d2c9dd3 (test pins them byte-equal) |
| 5 | 2 | NIT | tools/lib/cut-load-guard.sh | BRANCH | overlong all-digit min-cores override wraps in 10# arithmetic | FIXED | d2c9dd3 (4-digit cap) |
| 6 | 2 | NIT | tools/release.sh | BRANCH | serial body indentation at column 0 | DEFERRED | deliberate: byte-identical serial body for reviewability |
| 7 | 3 | NIT | tools/release.sh | BRANCH | parallel-mode _page_log temp leak on a suite-red abort | DEFERRED | parallel-only, harmless; clean fix risks the shared abort paths under a set -u asymmetry |
| 8 | 3 | NIT | tools/release.sh, tools/lib/cut-load-guard.sh | BRANCH | inline literals (nice -n 19, 0.5) vs SCREAMING_CASE | DEFERRED | idiomatic/borderline; value kept local to its rationale |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] SIGKILL orphan of the backgrounded nice'd suite (iteration 1) -- deferred
- [NIT] serial body indentation at column 0 (iteration 2) -- deferred, reviewability tradeoff
- [NIT] parallel-mode _page_log temp leak on a suite-red abort (iteration 3) -- deferred
- [NIT] inline literals nice -n 19 / 0.5 (iteration 3) -- deferred, idiomatic

### Strengths (across all iterations)
- The load-bearing safety invariant holds: both gates still RUN and still ABORT on a red
  suite or red page in BOTH serial and parallel modes; every abort path was traced. Verified
  not just asserted -- test-cut-parallel-region.sh extracts the region verbatim by marker and
  drives it under stubs asserting the dangerous direction in both modes (iterations 1, 2, 3).
- The serial (default) path is genuinely behavior-identical to before -- step 3/3b wrapped
  verbatim in `if [ "$_cut_parallel" != 1 ]`, shared analysis untouched (iteration 1).
- `set -u` safety is airtight: all four log/exit vars are always set before the shared
  analysis in both modes (iterations 1, 3).
- errexit handling of the backgrounded suite is correct and idiomatic (`( ... ) &`,
  `wait "$pid" || _suite_exit=$?`); the decision helper is invoked in an `if` condition
  (iterations 1, 2, 3).
- `kosmos_cut_parallel_ok` is fail-safe by construction in the correct (opposite-to-entry-gate)
  direction: every unreadable/out-of-range input returns serial (iterations 1, 2, 3).
- Test quality is thorough and decision-level: marker-extracted region test, unit-pinned
  decision cases, integration wiring assertion, all host-independent and red-capable
  (iterations 2, 3).
