---
pre_challenge: true
method: challenge-loop
branch: heavygate-testinstall-4410
diff_hash: 4e633f4510525c33a35ed2d12c811681bfd0d7b9ea404d86addd1abc039f369d
validation: passed
subdir_audit: passed
timestamp: 2026-09-28T22:10:43Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10
**Converged:** Yes (iteration 10: 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs)
**Total findings:** 30 (0 BLOCKERs, 20 WARNINGs, 2 CONVENTIONs, 8 NITs recorded below; some NITs folded in with their warnings)
**Fixed:** 27 | **Deferred:** 3 | **Asked (awaiting user):** 0

Validation between iterations: `node --test tools.heavy-gate-3805.test.js` (42 pass, 1 opt-in skip),
`bash tools/test-cut-guard.sh` (0 failures, end-to-end arms run on a quiet box at 20:19 UTC and
again in review 9 and 10), `tools/test-browser-run-guard.sh`, `tools/test-machine-claim-1962.sh`,
and `node --test tools.release-gate.test.js tools.cut-home-2724.test.js tools.shell-shard-4317.test.js
tools.every-test-runs.test.js`, all green. The full suite is NOT yet run behind heavy-gate; that is
the next step before merge.

Controls run by me (a check made to fail on purpose, then restored): the new heavy-gate tests red
against main's gate; the KOSMOS_HARNESS_KEEP_FIXTURES seam disabled turns the detection arm red; the
script-path half of the fixture rule removed turns test 117 red; the suite filter broken turns the
suite name arm red; the suite guard's found/none test inverted turns an arm red; test-install
dropped from heavy-gate's live awk filter turns the fake-ps live test red.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 5 NITs
**Self-generated:** 0 of the above
- [WARNING] tools/test-cut-guard.sh:236 — the suite's own stand-in harness became visible to every agent's heavy-gate and run-tests.sh --> FIXED (8c0301ca0: stand-in in the kt sandbox, KOSMOS_HARNESS_KEEP_FIXTURES seam)
- [WARNING] tools/test-install.sh:66 — suite check skipped for `yarn test:install-gate` outside a cut --> FIXED (8c0301ca0: scoped to kosmos_holds_machine_claim)
- [WARNING] tools/run-tests.sh:209 — a cut's own suite subject to the harness check --> FIXED (8c0301ca0)
- [CONVENTION] tools/who-has-the-box.sh:7 — header did not name test-install.sh --> FIXED (8c0301ca0)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above
- [WARNING] .claude/plans/heavygate-testinstall-4410.md — the stand-down's safety leaned on older guards the plan did not name --> FIXED (38f663c3c)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 3 of the above
- [WARNING] tools/test-install.sh:62 — the older cut check was skipped for KOSMOS_INSTALL_GATE=1 alone --> FIXED (2d8d3135a: claim holder only)
- [WARNING] tools/test-cut-guard.sh — the "dropped" arm could pass after the stand-in exited --> FIXED (2d8d3135a: 8 s, kill -0 before counting)
- [WARNING] tools/test-cut-guard.sh — stand-in's sandbox proof depended on lsof --> FIXED (2d8d3135a: absolute script path)
- [WARNING] tools/test-install.sh:65 — comment stated an unproven cause --> FIXED (2d8d3135a)
- [CONVENTION] tools/lib/cut-guard.sh — new function split a header from its function --> FIXED (2d8d3135a)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION (plan name, accepted practice), 0 NITs
**Self-generated:** 0 of the above
- [WARNING] tools/lib/cut-guard.sh — pgrep calling contract under set -e undocumented --> FIXED (4b8e0703f)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 2 of the above
- [WARNING] tools/lib/cut-guard.sh:626 — comment claimed the cut asks about suites at its start --> FIXED (2ad334272: the gap named in code and plan; raised on the PR)
- [WARNING] tools.heavy-gate-3805.test.js — the stand-in's real shape (normal cwd, sandboxed script) untested --> FIXED (2ad334272: test 117)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** 1 of the above
- [WARNING] tools/lib/cut-guard.sh:431 — comment overclaimed test coverage --> FIXED (7a0f071c5)
- [WARNING] tools/release.sh:339,380 — stale "fixed port" comments --> FIXED (7a0f071c5)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 2 of the above
- [WARNING] tools/lib/cut-guard.sh — suite guard's real name arm untested --> FIXED (6407ebe3f: _kosmos_suite_candidates tested by own pid)
- [WARNING] tools/test-install.sh — a harness will often refuse on a busy Mac --> FIXED in part (6407ebe3f: named in plan and refusal text); a wait-and-retry DEFERRED to a follow-up, raised on the PR
- [WARNING] tools/heavy-gate.sh — --except-cwd could rule out your own harness --> FIXED (6407ebe3f)
- [WARNING] tools/test-cut-guard.sh — end-to-end arms skipped on another agent's stand-in --> FIXED (6407ebe3f)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 0 NITs
**Self-generated:** 1 of the above
- [WARNING] tools/lib/cut-guard.sh:456 — the guard's glue after the source untested on the live path --> FIXED (5b2c96574: seam and live read share it; reviewer's mutation now red)

#### Iteration 9
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] tools/heavy-gate.sh:121 — live awk filter change untested --> FIXED (e448c7023: fake-ps row 950)
- [WARNING] tools/test-install-gate-control.sh:38 — a busy-box refusal would be scored as the gate's result --> FIXED (e448c7023)

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
**Converged** — no new actionable findings. The reviewer mutated three things in a copy (except-cwd rule, run-tests.sh wiring, suite regex) and each turned a test red.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | tools/test-cut-guard.sh:236 | BRANCH | stand-in visible to every gate | FIXED | 8c0301ca0 |
| 2 | 1 | WARNING | tools/test-install.sh:66 | BRANCH | suite check skipped outside a cut | FIXED | 8c0301ca0 |
| 3 | 1 | WARNING | tools/run-tests.sh:209 | BRANCH | cut's own suite not exempt | FIXED | 8c0301ca0 |
| 4 | 1 | CONVENTION | tools/who-has-the-box.sh:7 | BRANCH | header stale | FIXED | 8c0301ca0 |
| 5 | 2 | WARNING | plan | SELF | unnamed load-bearing guards | FIXED | 38f663c3c |
| 6 | 3 | WARNING | tools/test-install.sh:62 | BRANCH | old cut check too wide | FIXED | 2d8d3135a |
| 7 | 3 | WARNING | tools/test-cut-guard.sh | SELF | dropped arm could be vacuous | FIXED | 2d8d3135a |
| 8 | 3 | WARNING | tools/test-cut-guard.sh | SELF | proof depended on lsof | FIXED | 2d8d3135a |
| 9 | 3 | WARNING | tools/test-install.sh:65 | SELF | unproven cause stated | FIXED | 2d8d3135a |
| 10 | 3 | CONVENTION | tools/lib/cut-guard.sh | BRANCH | header split | FIXED | 2d8d3135a |
| 11 | 4 | WARNING | tools/lib/cut-guard.sh | BRANCH | set -e contract undocumented | FIXED | 4b8e0703f |
| 12 | 5 | WARNING | tools/lib/cut-guard.sh:626 | SELF | suite-at-cut-start gap hidden | FIXED | 2ad334272 |
| 13 | 5 | WARNING | tools.heavy-gate-3805.test.js | SELF | stand-in shape untested | FIXED | 2ad334272 |
| 14 | 6 | WARNING | tools/lib/cut-guard.sh:431 | SELF | coverage overclaimed | FIXED | 7a0f071c5 |
| 15 | 6 | WARNING | tools/release.sh:339 | BRANCH | stale fixed-port comments | FIXED | 7a0f071c5 |
| 16 | 7 | WARNING | tools/lib/cut-guard.sh | BRANCH | real name arm untested | FIXED | 6407ebe3f |
| 17 | 7 | WARNING | tools/test-install.sh | BRANCH | busy-box refusals | FIXED (named) / wait DEFERRED | 6407ebe3f |
| 18 | 7 | WARNING | tools/heavy-gate.sh | BRANCH | except-cwd drops own harness | FIXED | 6407ebe3f |
| 19 | 7 | WARNING | tools/test-cut-guard.sh | SELF | skips on foreign stand-in | FIXED | 6407ebe3f |
| 20 | 8 | WARNING | tools/lib/cut-guard.sh:456 | SELF | live glue untested | FIXED | 5b2c96574 |
| 21 | 9 | WARNING | tools/heavy-gate.sh:121 | BRANCH | live awk filter untested | FIXED | e448c7023 |
| 22 | 9 | WARNING | tools/test-install-gate-control.sh:38 | BRANCH | refusal scored as verdict | FIXED | e448c7023 |

### Outstanding questions (ASKED, still unresolved when the run ended)
- None in the loop. Two policy points go to Liu Kang on the PR, not as blockers: whether a cut should refuse
  when an agent's suite is already running at its start, and whether test-install.sh should wait and retry
  instead of refusing on a busy Mac.

### NITs (non-blocking, across all iterations)
- [NIT] tools/lib/cut-guard.sh:461 — rc normalisation redundant for the real source (iteration 9, 10); kept so seam and live read share it
- [NIT] tools/test-install.sh — the two stand-down conditions are written in different orders (iteration 10)
- [NIT] tools/lib/cut-guard.sh — suite guard misses zsh, bare-name and bare `node --test` shapes (iteration 3); named in its comment
- [NIT] test seams KOSMOS_SUITE_PROBE / KOSMOS_SUITE_SELF_PID can weaken the guard if left set, as the older guards' can (iteration 5); named in the plan

### Strengths (across all iterations)
- Every new check has a control that differs only in the deciding detail, and each was made to fail on purpose once.
- The stand-ins are sandboxed fixtures to every guard on the Mac except the one test that needs to see them.
- The claim-holder stand-down is scoped by cookie, with the older guards it leans on named in code.
