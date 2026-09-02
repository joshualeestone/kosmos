---
pre_challenge: true
method: challenge-loop
branch: machine-runnable-1641
diff_hash: 5470f8c28beec869d9eb9e9fbb8419250f32c25576d3b10f0bb012e21d967749
validation: passed
subdir_audit: passed
timestamp: 2026-09-02T03:16:03Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 (fresh, blind, independent)
**Converged:** Yes — iteration 1 returned zero NEW BLOCKER/WARNING/CONVENTION findings, and no unresolved ASKED findings.
**Total findings:** 1 (0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT — reviewer marked "no change needed")
**Fixed:** 0 | **Deferred:** 1 (NIT) | **Asked:** 0

### Why one iteration is convergence here

This is a small, mechanical convergence: `engine/machine.js`'s `installedCheck` used to
inline the last copy of the "is this runnable" check (`st.isFile()` + `accessSync X_OK`)
that #1592 converged four other sites off; it now delegates to the single exported
definition `runners.isRunnable(bin)`. There is no destructive path (unlike #1511's
`rm -rf` steering, where a second confirming pass was warranted as insurance). The blind
reviewer verified the change **empirically**, not just by reading: it ran the full test
file (22/22), traced the require graph to a leaf (`machine → runners → platform`, no
cycle), grepped that the census regex captures exactly `accessSync(bin, X_OK` from the new
prose comment and resolves its enclosing fn to `installedCheck`, and **perturbed the
behavioural arm itself** (forcing the branch true) to confirm it still reds naming the key,
restoring byte-identical. Zero actionable findings on that basis is genuine convergence;
running a confirming pass would be the drift the skill names.

**Validation note:** the canonical `validation_log_run_or_skip` helper misdetects this
npm / plain-JavaScript repo as a pnpm/TypeScript stack (`pnpm typecheck`, which does not
exist here), so it exits non-zero for an unrelated stack reason. Validation was done with
the repo's real gate, `bash tools/run-tests.sh` (the node suite the `test` script runs)
on the committed HEAD (3988bad8): **3674 node tests passed, 0 failed (`✖`=0), all shell
sub-suites green**. `engine/machine.js` is core engine code imported widely, so the full
suite is the right gate. Nothing changed after that run, so it is the 6j final gate.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
- [NIT] engine/machine.js:382 — `fs.statSync(bin);` as a bare expression statement (called only for its throw, to classify ENOENT-vs-unreadable) is slightly unusual --> DEFERRED: intentional and clearly documented at lines 377-380; dropping `let st` removes a would-be unused variable. Reviewer stated "No change needed."

**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | NIT | engine/machine.js:382 | bare `fs.statSync(bin)` expression statement (throw-only) | DEFERRED | intentional, documented; reviewer said no change needed |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking)
- [NIT] engine/machine.js:382 — bare `fs.statSync` for classification (iteration 1) — DEFERRED, documented

### Strengths (from the blind pass)
- `installedCheck` now delegates to `runners.isRunnable(bin)`, behaviorally equivalent for every case (real executable → true, directory → false via isRunnable's own statSync().isFile(), no-exec-bit → false, vanished/broken-symlink → outer statSync throws ENOENT and never reaches isRunnable). Verified by reading both functions and running the suite.
- The ENOENT-vs-EACCES(`null`) classification is preserved after discarding `st`: the outer statSync's result was only ever used for `.isFile()` (now inside isRunnable); the classification uses only the throw, untouched.
- No require cycle: `machine → runners → platform`, and platform.js requires no app module (a leaf).
- Census pin correct and non-vacuous: exactly one line matches WEAK_CALL (the new prose comment), its greedy `m[0]` is precisely `accessSync(bin, X_OK`, enclosing fn `installedCheck`; a fresh weak call would still red as an unknown key.
- Convention consistency: connect.js and devicedoor.js keep pinned prose warnings after converging their real call; machine.js now follows the identical sibling pattern.
- Behavioural arm still guards runnability for all three keys and fails on demand (reviewer perturbed and restored).
- Marginally MORE correct than the original in the file→directory TOCTOU window: the fresh statSync inside isRunnable re-checks isFile(), where the old code reused a stale `st.isFile()`.
