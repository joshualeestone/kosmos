---
pre_challenge: true
method: challenge-loop
branch: codex-account-home-2906
diff_hash: 90902386ee08f23206b45645e5cb295aa70abc13a73d61c85d766549b2bb61fb
validation: passed
subdir_audit: passed
timestamp: 2026-09-12T17:14:22Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3 surfaced zero new actionable findings)
**Total findings:** 11 (0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 6 NITs)
**Fixed:** 6 | **Deferred:** 5 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 2 NITs
**Self-generated:** 0 of the above (only the plan-file commit had landed; findings cite pre-existing branch lines)
- [CONVENTION] .claude/plans/ — No plan file for this branch --> FIXED (2af5f536)
- [WARNING] engine/discover.js:380 — found() scans only the board/default Codex home --> DEFERRED: distinct machine-wide adoption-discovery concern, not the per-agent status read #2906 fixes
- [NIT] engine/status.js:4619 — fail-closed guard's runner!=='codex' and !dir arms not directly asserted --> FIXED (2893c8fc)
- [NIT] engine/status.codex-account-home-2906.test.js:154 — test #5 assertion message said "empty home" for a populated home --> FIXED (2893c8fc)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above (finding on test #9, a line added by iteration 1's own commit; a test finding, fixed normally)
**Duplicates of prior findings:** 0
- [WARNING] engine/status.codex-account-home-2906.test.js:196 — test #9 passed for the wrong reason: create.workerDir never returns falsy/throws for a normal name, so the guessed dir simply mismatched the rollout cwd and the !dir arm was never exercised --> FIXED (a2267d29): rewrote #9 to stub create.workerDir to throw, with a positive control (reads 88888 with workerDir working) so the stub is the only variable. NOTE the !dir *condition* is redundant (codexsession.read(null) also fails closed); the load-bearing part the test discriminates is the try/catch that converts a workerDir throw into fail-closed.
- [WARNING] engine/status.codex-observed-2413.test.js:116 — perf-stub monkeypatch dropped the new optional home arg --> FIXED (a2267d29): forwards (dir, home)
- [WARNING] server.js:6244 and server.js:6280 — two "codexsession reads the default home alone" invariant comments, now false, justify disclosing codex-session loss only on a *default*-account delete/disconnect; a labelled account's now-visible sessions are lost undisclosed --> DEFERRED: out of scope for the read fix; requires flipping product-copy tests that encode the old premise. Filed follow-up card kosmos#2941.
- [NIT] .claude/plans/codex-account-home-2906.md:39 — "7 regression tests" now 9 --> FIXED (a2267d29)
- [NIT] engine/status.js:4617 — try/catch around readJob unreachable (readJob catches internally) --> DEFERRED: matches the existing defensive style at the dir line and other call sites; harmless

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs (both non-actionable)
**Self-generated:** 0 of the above
**Converged** — no new actionable findings.
- [NIT] engine/status.js:4618 — one extra plist read + parse per codex pane per tick --> DEFERRED: bounded once-per-tick (codexSess computed once at 6351 and threaded to both consumers), negligible beside the rollout-tree walk; by design
- [NIT] engine/status.js:4620 — a codex agent with no plist fails closed to "not yet read" --> DEFERRED: deliberate and correct; unreachable for normal/adopted agents (both write a codex plist), covered by test 4

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | CONVENTION | .claude/plans/ | BRANCH | No plan file for branch | FIXED | 2af5f536 |
| 2 | 1 | WARNING | engine/discover.js:380 | BRANCH | found() scans board/default home only | DEFERRED | distinct adoption-discovery concern, out of scope |
| 3 | 1 | NIT | engine/status.js:4619 | BRANCH | runner!=='codex' and !dir arms untested | FIXED | 2893c8fc (tests #8/#9) |
| 4 | 1 | NIT | ...codex-account-home-2906.test.js:154 | BRANCH | misleading test #5 assertion message | FIXED | 2893c8fc |
| 5 | 2 | WARNING | ...codex-account-home-2906.test.js:196 | SELF | test #9 passed for wrong reason (!dir not exercised) | FIXED | a2267d29 (stub+control) |
| 6 | 2 | WARNING | ...codex-observed-2413.test.js:116 | BRANCH | perf-stub dropped new home arg | FIXED | a2267d29 |
| 7 | 2 | WARNING | server.js:6244/6280 | BRANCH | stale invariant + labelled-delete disclosure omits session loss | DEFERRED | follow-up card kosmos#2941 |
| 8 | 2 | NIT | .claude/plans/...:39 | BRANCH | "7 tests" now 9 | FIXED | a2267d29 |
| 9 | 2 | NIT | engine/status.js:4617 | BRANCH | readJob try/catch unreachable | DEFERRED | matches existing defensive style |
| 10 | 3 | NIT | engine/status.js:4618 | BRANCH | extra plist read per tick | DEFERRED | bounded, negligible, by design |
| 11 | 3 | NIT | engine/status.js:4620 | BRANCH | no-plist fails closed | DEFERRED | deliberate, correct, covered by test 4 |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] engine/status.js:4617 — unreachable readJob try/catch (iteration 2, deferred: defensive style)
- [NIT] engine/status.js:4618 — extra plist read per tick (iteration 3, deferred: negligible)
- [NIT] engine/status.js:4620 — no-plist fail-closed edge (iteration 3, deferred: by design)

### Strengths (across all iterations)
- Fail-closed design verified sound: home = job.configDir || defaultAgentCodexHome() is always a truthy non-board home, so the board's CODEX_HOME can never bleed into a cross-account read (iterations 1, 2, 3)
- Cross-account decoy fixtures are genuine negative controls (same workdir planted in a wrong account home), so a leak produces a visibly wrong token number rather than a silent pass (iterations 1, 2, 3)
- The once-per-tick shared read (#2413) is preserved: the added readJob lookup happens inside the single readCodexSession call, no double-read regression (iteration 3)
- Minimal backward-compatible signature widening: every existing direct caller keeps the process-default home; only status.readCodexSession opts into per-agent resolution (iterations 1, 2, 3)
