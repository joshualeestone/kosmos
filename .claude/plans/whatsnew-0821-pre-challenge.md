---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0821
diff_hash: fa5d5b1b6942008f2363693167354ad8ded556e34b9141901a6510adc6674e98
validation: targeted (every test that reads the What's New files; the full suite runs in the 0.8.21 cut, pinned at this merge)
subdir_audit: not run (no CLAUDE.md changed)
timestamp: 2026-11-24T20:08:31Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3 raised only NITs)
**Total findings:** 2 actionable (0 BLOCKERs, 1 WARNING, 1 from the targeted test run), plus NITs
**Fixed:** 2 | **Deferred:** 0 | **Asked (awaiting user):** 0

**Validation, stated exactly.** The queued full validation had four runs ahead of it, so I stopped it and ran every
test that reads web/whats-new.json, release/whats-new-pool.json or engine/whatsnew.js (found with git grep):
the seven What's New node files (86 pass, 0 fail), engine/releasenotes, server, tools.release-gate,
web.fedinvreturn-8938, web.modal-way-out-1316, web.reload-toast and engine.reachable (518 tests: 517 pass, 0 fail,
1 counted as neither), tools/test-whats-new-early-7349.sh (ALL PASS) and tools/test-release-detached.sh (0 failures).
The browser checks were not run (no page change). The full suite runs in the cut, pinned at this merge.

Self-generated column: the 6c-bis blame lookup was not run; every finding is recorded BRANCH.

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
- [WARNING] release/whats-new-pool.json:2743 - the msg --status notes line left out "not read yet", the CLI's most common pending answer --> FIXED (ca1b437909)
- [NIT] "its card says" is the pill's hover and the agent's page (#8987's own wording, and Mona Lisa's copy read kept it)
- [NIT] the two older Mac lines say "now" (wording predates this branch)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
- [NIT] "answered" vs the CLI's "replied"; the line summarises four of eight sentences
- [NIT] rank 140 ties another notes-only entry (no effect: notes never reach the window)
- Targeted test run after this iteration: [BLOCKER] tools.whats-new-pool-5711.test.js:93 - expected min(5, pending) but notes-only items are pending and never chosen; main hid it with 7 non-notes pending, this build leaves 3 --> FIXED (14ecc6cb09)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
- [NIT] "answered" is "answered by command"; "never delivered" covers held-not-yet-typed
- [NIT] rank 140 tie
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | release/whats-new-pool.json:2743 | BRANCH | notes line omitted "not read yet" | FIXED | ca1b437909 |
| 2 | 2 | BLOCKER | tools.whats-new-pool-5711.test.js:93 | BRANCH | real-pool test counted notes-only items | FIXED | 14ecc6cb09 |

### Copy read
Mona Lisa read the Windows line (fleetreleases m6355): good as it is.

### Strengths
- Both new lines are true to the merged code (restartWhy and stateReason; msgstatus.js and msg --status), checked by three reviewers.
- The build's bookkeeping marks exactly 0.8.20's five window titles shown and records Mac and Windows prod 0.8.20.
- An offline rebuild of the committed pool is byte-identical to web/whats-new.json; prod-check rc 0.
