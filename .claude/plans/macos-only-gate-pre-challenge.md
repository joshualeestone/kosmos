---
pre_challenge: true
method: challenge-loop
branch: macos-only-gate
diff_hash: 1efb8c6ff08a90f96c0c915c63c4c917fc9291dc9c1ad9a588e14c853934736a
validation: passed
subdir_audit: passed
timestamp: 2026-09-01T09:23:08Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3 found zero NEW BLOCKER/WARNING/CONVENTION)
**Total findings:** 0 BLOCKER, 1 WARNING, 0 CONVENTION, 7 NITs, many STRENGTHs
**Fixed:** 1 WARNING + 3 NITs | **Deferred:** 4 NITs (acknowledged tradeoffs) | **Asked:** 0

Full suite `bash tools/run-tests.sh` -> 3460/3460 on the current base. This is
Option A of the cross-platform analysis: a non-macOS board refuses honestly. It is
the MECHANISM ONLY -- the user-facing "runs on macOS" copy/screen is the operator's
and is not built here; and it makes no part of Windows look functional (it refuses,
it does not fetch a non-Mac build). Mid-loop, a blind reviewer flagged the
provider-binary download as the one user-reachable Mac-only path the substrate gate
did not cover; Splinter ruled to extend the gate to it, which iteration 3 reviewed.

### Per-Iteration Breakdown

#### Iteration 1 (substrate gate)
**New findings:** 1 WARNING, 3 NITs
- [WARNING] engine/connect.js:717 — the provider-binary download is a user-reachable Mac-only path NOT covered by the live-execution gate; a non-macOS board would still fetch a ~281MB darwin binary that cannot run. --> Initially DEFERRED as the deliberate Option A/C boundary, then FIXED after Splinter ruled to extend the gate (see iteration 3 and the connect/runners gates).
- [NIT] engine/platform.test.js — a constant-expression (`undefined===undefined?...`) read as testing the undefined path but did not. --> FIXED (ad128e2e).
- [NIT] engine/platform.js — the default-param/undefined asymmetry was undocumented. --> FIXED (ad128e2e): documented that only the no-arg default reads the process; every real value fails closed.
- [NIT] the source-asserted server.js wiring test is brittle to reformatting. --> DEFERRED (acknowledged tradeoff; the real-start block is not test-executable).

#### Iteration 2 (substrate gate)
**New findings:** 3 NITs, 0 actionable
- [NIT] the server.js stderr diagnostic is the one string brushing the copy boundary (operator-facing, not product copy). --> DEFERRED (no change needed).
- [NIT] the source-assertion is brittle to a benign reformat. --> DEFERRED (acknowledged tripwire).
- [NIT] the behavioral firstrun test is partly self-referential but saved from vacuity by the exact key-set pin. --> DEFERRED (fine as-is).
Converged on the substrate gate; then Splinter ruled to extend scope to the downloads.

#### Iteration 3 (download gate, added per Splinter's ruling)
**New findings:** 1 NIT, 0 actionable
- [NIT] engine/connect.js — the download refusal said "the agent runner is a macOS build"; download() fetches the Claude Code binary, and "runner" is runners.js's term. --> FIXED (b87d9be8): "the Claude Code binary is a macOS build".
**Converged** — 5 STRENGTHs confirming both download gates are placed before any byte movement and surface correctly, backward compatibility (the new download() 3rd param defaults to process.platform), fail-closed with no Windows made functional, and non-vacuous network-free tests.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/connect.js:717 | provider-binary download uncovered by the substrate gate | FIXED | ddf54812 (gate extended per Splinter) |
| 2 | 1 | NIT | engine/platform.test.js | misleading constant-expression test | FIXED | ad128e2e |
| 3 | 1 | NIT | engine/platform.js | default-param asymmetry undocumented | FIXED | ad128e2e |
| 4 | 1 | NIT | wiring test | source-assert brittle to reformat | DEFERRED | acknowledged tradeoff |
| 5 | 2 | NIT | server.js stderr | the one string near the copy boundary | DEFERRED | operator diagnostic, not product copy |
| 6 | 2 | NIT | firstrun wiring test | partly self-referential | DEFERRED | saved by exact key-set pin |
| 7 | 3 | NIT | engine/connect.js | "runner" vs "Claude Code binary" wording | FIXED | b87d9be8 |

### NITs (deferred, non-blocking)
- source-asserted server.js wiring test is brittle to a benign reformat (acknowledged tripwire; the real-start block is not test-executable by design)
- the server.js stderr diagnostic brushes the copy boundary but is operator-facing, not product copy
- the behavioral firstrun test is partly self-referential but pinned by the exact key set

### Strengths (across all iterations)
- engine/platform.js is pure and parameterized (isSupported(platform = process.platform)) like store.dataRootFor, so every non-macOS branch is testable on this Mac; fails closed (null/''/unknown -> false); SUPPORTED is Object.freeze'd; requires nothing (no cycle)
- the substrate gate is fail-closed and complete: allowLiveExecution() has exactly one call site, now gated by isSupported(); all four guarded ops (create/remove/delete-leftover/update) dry-run/refuse when unarmed; macOS arms exactly as before
- both download gates refuse before any byte movement: connect.download() throws at the top (caught by installClaudeCode -> PHASE.STUCK, no dangling request/state); runners.install() returns its job-shaped refuse before any side effect; both backward compatible (the download() 3rd param defaults to process.platform)
- fail-closed with no Windows made functional: neither gate fetches a non-Mac build; refusal reasons name the platform but are factual, not polished product copy; scope respected (no Option C download fix, no user-facing screen/string; the web/index.html Windows refs are untouched)
- tests are non-vacuous and network-free: the download-gate tests refuse on two distinct platforms each naming itself (param-keyed, not hardcoded), with a control pair proving the gate fires before other checks on win32 and does not fire on darwin, no download in any arm; the wiring test source-asserts the require.main block tests never execute and pins allowLiveExecution() to one call site
