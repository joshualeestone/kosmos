---
pre_challenge: true
method: challenge-loop
branch: unify-board-shape-2860
diff_hash: 456c168b024164433ac3b95d567d9b778f877959e300ea092943a224a34e2787
validation: passed
subdir_audit: passed
timestamp: 2026-09-12T08:57:00Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 blind review passes (opus, sonnet), preceded by a 6.0 fix-and-validate pass
**Converged:** Yes (iteration 2 / sonnet surfaced zero BLOCKER/WARNING/CONVENTION)
**Total findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs + 1 synthetic 6.0 regression
**Fixed:** the 6.0 test regression + all 3 NITs | **Deferred:** 0 | **Asked:** 0

The 6.0 initial validation caught a REAL test regression: `install.local-board.test.js`
(a structural grep-test of release.sh) pinned the OLD inline step-10a shape derivation
that the refactor replaced. Two of its assertions broke and both were fixed while
preserving the test's intent (see iteration 1). Every fix was validated by the full
suite (0 node failures; 6j `validation PASSED hash=456c168b0241`).

### Per-Iteration Breakdown

#### 6.0 initial validation (fix-and-validate)
**New findings:** 1 synthetic BLOCKER (initial-validation)
**Self-generated:** 0 (synthetic, Origin BRANCH by instruction)
- [BLOCKER] install.local-board.test.js — the ordering check anchored on a bare `tools/restart-local-board.sh`, which the new #2860 source-line COMMENT now matches before the actual invocation (indexOf first hit) -> `restart > deploy` false-failed; AND the gate-pattern assertion matched the literal old `[ -n "$_board_wd" ] && [ "$_board_wd" = "$_board_libexec" ]`, which moved into `board_shape_of`. --> FIXED (re-anchor on `$MAIN_REPO/tools/restart-local-board.sh`; assert the equivalent new `[ "$(board_shape_of "$_board_wd" "" "$_board_libexec")" = libexec ]` gate). Behavior-preserving refactor; test updated to match. install.local-board.test.js passes 3/3.

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
- [NIT] tools/lib/board-shape.sh — `board_shape_of` used plain globals; harmless (callers use `$(...)`) but a future non-subshell caller would clobber them --> FIXED (declare `local _bs_wd _bs_repo _bs_libexec`; verified works when sourced under both sh and bash)
- [NIT] package.json — the new test wasn't `bash -n` pre-checked like sibling entries --> FIXED (paired `bash -n tools/test-board-shape-2860.sh`)
- [STRENGTH] faithful no-behavior-change refactor; identical WD parse; genuine non-vacuous test; correct sourcing placement

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0
- [NIT] commit `8bc94d9a` subject mixed the two accepted forms (`#2860 -- ...`) --> FIXED (amended to `#2860: ...`, the `#N: <message>` form; diff content unchanged so the hash is unaffected)
**Converged** — the reviewer RAN `tools/test-restart-local-board.sh` (26 assertions), `install.local-board.test.js` (3/3), and `tools/test-board-shape-2860.sh` (14/14) against the refactored code, confirmed each caller's decision is preserved 1:1, and confirmed the install.local-board test fix is real and red-capable. No blocker/warning/convention.

### Final Ledger

| # | Iter | Category | Origin | Description | Status |
|---|------|----------|--------|-------------|--------|
| 1 | 6.0 | BLOCKER (synthetic) | BRANCH | install.local-board.test.js pinned the old inline shape gate/ordering | FIXED |
| 2 | 1 | NIT | BRANCH | board_shape_of used plain globals (no local) | FIXED |
| 3 | 1 | NIT | BRANCH | test not bash -n pre-checked in package.json | FIXED |
| 4 | 2 | NIT | SELF | intermediate commit subject format | FIXED |

### Strengths (across passes)
- Faithful no-behavior-change refactor: release.sh's inline libexec gate == `board_shape_of "$wd" "" "$libexec" = libexec` (empty repo arg makes `repo` unreachable); restart's 3-way if/elif/else maps 1:1 onto the `case`. Verified by inspection AND by running the tests.
- The WD parse (`sed -n 's/^[[:space:]]*working directory = //p' | head -1`) is byte-for-byte identical to both callers' prior derivations.
- `tools/test-board-shape-2860.sh` is non-vacuous: covers repo/libexec/foreign/empty-bundle/aliased-symlink, with a red-capable exact-match tripwire (an aliased WD classifies `other`; realpath normalization would flip it) plus a positive control.
- Directly eliminates the codebase's most-shipped defect class (CLAUDE.md convention #5: two derivations of one fact) with a shared, unit-tested classifier and a documented deliberate decision on the one ambiguous case (symlink normalization).

### Notes
Deliberate call (documented in the plan and the lib): the shape comparison stays an EXACT string
match, not realpath/pwd -P normalization -- install-board.sh sets the launchd WorkingDirectory to
the same string as libexec, so they agree by construction; normalizing would turn a fail-safe no-op
into an action in the release-critical cut path. The single classifier is the one place to add
normalization if a real launchd-canonicalization divergence is ever measured. No rendered web/
surface touched (browser-check gate N/A); the new `.sh` test is wired into `test:shell`.
