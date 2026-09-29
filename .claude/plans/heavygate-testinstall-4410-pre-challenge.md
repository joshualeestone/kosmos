---
pre_challenge: true
method: challenge-loop
branch: heavygate-testinstall-4410
diff_hash: 47bca808c7f107d106a67a9d21c8e2399a5856a5c3e008b1ed3b9582b3c3d3b5
validation: passed
subdir_audit: passed
timestamp: 2026-09-28T23:27:49Z
iterations: 14
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 14
**Converged:** Yes (iteration 14: 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT)
**Total findings:** 0 BLOCKERs, 27 WARNINGs, 4 CONVENTIONs, NITs listed below
**Fixed:** 30 | **Deferred:** 1 (a harness wait-and-retry, raised on the PR) | **Asked (awaiting user):** 0

Validation: `node --test tools.heavy-gate-3805.test.js` (42 pass, 1 opt-in skip);
`bash tools/test-cut-guard.sh` (0 failures, also under a simulated kt TMPDIR; end-to-end arms run on a
quiet box); `tools/test-browser-run-guard.sh`; `tools/test-machine-claim-1962.sh`; release-gate,
cut-home, shell-shard and every-test-runs node tests. The full suite was green at 0690873d3
(11446 tests, 11281 pass, 0 fail, 165 skipped; the shell part too). The first full run, at
3b584cdb1, caught 1 red in this branch's own --except-cwd test (fixed in 0690873d3). A full run on
this final head follows before merge.

Controls made to fail on purpose once each, then restored: the new gate tests against main's gate;
the KOSMOS_HARNESS_KEEP_FIXTURES seam off; the script-path fixture check removed; the suite filter
broken; the suite guard's found/none test inverted; test-install dropped from heavy-gate's live
filter; run-tests.sh's override argument dropped; the fixture rule's interpreter narrowed back.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION
**Self-generated:** 0
- [WARNING] tools/test-cut-guard.sh: the suite's stand-in harness visible to every gate --> FIXED (8c0301ca0)
- [WARNING] tools/test-install.sh: suite check skipped outside a cut --> FIXED (8c0301ca0)
- [WARNING] tools/run-tests.sh: a cut's own suite not exempt --> FIXED (8c0301ca0)
- [CONVENTION] tools/who-has-the-box.sh: header stale --> FIXED (8c0301ca0)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 1 WARNING
**Self-generated:** 1
- [WARNING] plan: the stand-down's load-bearing older guards unnamed --> FIXED (38f663c3c)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 4 WARNINGs, 1 CONVENTION
**Self-generated:** 3
- [WARNING] tools/test-install.sh: old cut check skipped for KOSMOS_INSTALL_GATE=1 alone --> FIXED (2d8d3135a)
- [WARNING] tools/test-cut-guard.sh: dropped arm could pass on an empty table --> FIXED (2d8d3135a)
- [WARNING] tools/test-cut-guard.sh: sandbox proof depended on lsof --> FIXED (2d8d3135a)
- [WARNING] tools/test-install.sh: unproven cause stated --> FIXED (2d8d3135a)
- [CONVENTION] tools/lib/cut-guard.sh: header split from its function --> FIXED (2d8d3135a)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 1 WARNING
**Self-generated:** 0
- [WARNING] tools/lib/cut-guard.sh: set -e calling contract undocumented --> FIXED (4b8e0703f)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 2 WARNINGs
**Self-generated:** 2
- [WARNING] tools/lib/cut-guard.sh: suite-already-running-at-cut-start gap hidden --> FIXED (2ad334272, named; raised on the PR)
- [WARNING] tools.heavy-gate-3805.test.js: the stand-in's real shape untested --> FIXED (2ad334272)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs
**Self-generated:** 1
- [WARNING] tools/lib/cut-guard.sh: coverage overclaimed --> FIXED (7a0f071c5)
- [WARNING] tools/release.sh: stale fixed-port comments --> FIXED (7a0f071c5)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 4 WARNINGs
**Self-generated:** 2
- [WARNING] tools/lib/cut-guard.sh: suite guard's real name arm untested --> FIXED (6407ebe3f)
- [WARNING] tools/test-install.sh: a harness often refuses on a busy Mac --> FIXED (named in refusal and plan); wait-and-retry DEFERRED, raised on the PR
- [WARNING] tools/heavy-gate.sh: --except-cwd could rule out your own harness --> FIXED (6407ebe3f)
- [WARNING] tools/test-cut-guard.sh: skips on another agent's stand-in --> FIXED (6407ebe3f)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 1 WARNING
**Self-generated:** 1
- [WARNING] tools/lib/cut-guard.sh: live glue untested --> FIXED (5b2c96574)

#### Iteration 9
**Reviewer model:** opus
**New findings:** 2 WARNINGs
**Self-generated:** 1
- [WARNING] tools/heavy-gate.sh: live awk filter untested --> FIXED (e448c7023)
- [WARNING] tools/test-install-gate-control.sh: busy refusal scored as a verdict --> FIXED (e448c7023)

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
Converged at 3b584cdb1. The full suite then caught 1 red in this branch's own test (os.tmpdir() is the
kt sandbox inside run-tests.sh), fixed in 0690873d3, so the loop resumed.

#### Iteration 11
**Reviewer model:** opus
**New findings:** 1 WARNING, 5 NITs
**Self-generated:** 1
- [WARNING] tools/test-install-gate-control.sh: busy skip exited 1, like a real red --> FIXED (5481f154d, exit 3)

#### Iteration 12
**Reviewer model:** sonnet
**New findings:** 3 WARNINGs, 1 CONVENTION
**Self-generated:** 3
- [WARNING] tools/test-install-gate-control.sh: comment claimed a harness-vs-harness refusal --> FIXED (d50f66854)
- [WARNING] tools/test-install-gate-control.sh: dist-missing skip exited 1 --> FIXED (d50f66854)
- [WARNING] tools/test-cut-guard.sh: run-tests.sh's override argument unpinned --> FIXED (d50f66854)
- [CONVENTION] pre-challenge proof: em dashes --> FIXED (this file is rewritten without them)

#### Iteration 13
**Reviewer model:** opus
**New findings:** 2 WARNINGs, 2 NITs
**Self-generated:** 2
- [WARNING] tools/test-install-gate-control.sh: could-not-tell refusal scored as red --> FIXED (aa087a0bd)
- [WARNING] tools/lib/cut-guard.sh: fixture rule narrower than the suite arm --> FIXED (aa087a0bd)

#### Iteration 14
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0
**Converged**: no new actionable findings. The reviewer mutated every new check in a copy; each turned a test red.

### Final Ledger

| # | Iter | Category | File | Origin | Status | Resolution |
|---|------|----------|------|--------|--------|------------|
| 1-4 | 1 | WARNING x3, CONVENTION | test-cut-guard, test-install, run-tests, who-has-the-box | BRANCH | FIXED | 8c0301ca0 |
| 5 | 2 | WARNING | plan | SELF | FIXED | 38f663c3c |
| 6-10 | 3 | WARNING x4, CONVENTION | test-install, test-cut-guard, cut-guard | BRANCH/SELF | FIXED | 2d8d3135a |
| 11 | 4 | WARNING | cut-guard | BRANCH | FIXED | 4b8e0703f |
| 12-13 | 5 | WARNING x2 | cut-guard, heavy-gate test | SELF | FIXED | 2ad334272 |
| 14-15 | 6 | WARNING x2 | cut-guard, release.sh | SELF/BRANCH | FIXED | 7a0f071c5 |
| 16-19 | 7 | WARNING x4 | cut-guard, test-install, heavy-gate, test-cut-guard | BRANCH/SELF | FIXED (1 part DEFERRED) | 6407ebe3f |
| 20 | 8 | WARNING | cut-guard | SELF | FIXED | 5b2c96574 |
| 21-22 | 9 | WARNING x2 | heavy-gate, gate-control | BRANCH | FIXED | e448c7023 |
| 23 | 11 | WARNING | gate-control | SELF | FIXED | 5481f154d |
| 24-27 | 12 | WARNING x3, CONVENTION | gate-control, test-cut-guard, proof | SELF | FIXED | d50f66854 |
| 28-29 | 13 | WARNING x2 | gate-control, cut-guard | SELF | FIXED | aa087a0bd |

### Outstanding questions (ASKED, still unresolved when the run ended)
- None in the loop. Two policy points are on the PR for Liu Kang, not blockers: whether a cut should
  refuse when a suite is already running at its start, and whether test-install.sh should wait and
  retry instead of refusing on a busy Mac.

### NITs (non-blocking, across all iterations)
- [NIT] tools/lib/cut-guard.sh: the harness guard's comment does not name that its interpreter regex is narrower than _kosmos_suite_candidates's (iteration 14)
- [NIT] tools/lib/cut-guard.sh: rc normalisation is redundant for the real suite source (kept so seam and live read share it)
- [NIT] tools/test-cut-guard.sh: the seam-kept detection arm cannot prove whose stand-in the guard saw; an own-pid check beside it narrows this
- [NIT] test seams KOSMOS_SUITE_PROBE and KOSMOS_SUITE_SELF_PID can weaken the guard if left set, as the older guards' seams can

### Strengths (across all iterations)
- Every new check has a control that differs only in the deciding detail, and each was made to fail on purpose.
- Stand-ins are sandboxed fixtures to every guard on the Mac except the one arm that must see them.
- The claim-holder stand-down is scoped by cookie, and the older guards it leans on are named in code.
