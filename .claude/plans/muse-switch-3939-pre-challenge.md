---
pre_challenge: true
method: challenge-loop
branch: muse-switch-3939
diff_hash: 2906a79055f6c0925e2ba14646b5e85697e8a9c0f76d69e54682cb6c40079188
validation: passed
subdir_audit: passed
timestamp: 2026-09-28T18:44:39Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes
**Total findings:** 20 (0 BLOCKERs, 7 WARNINGs, 0 CONVENTIONs, 13 NITs)
**Fixed:** 7 WARNINGs and 9 NITs | **Deferred:** 0 | **Asked (awaiting user):** 0

Initial validation passed. Validation after iteration 2 went red only on the #3011 LaunchAgents leak guard
(three zz-test-4039-* agents another agent created on the live board at 13:02, mid-run; gone by 13:08).
Validation after iteration 3 went red only on tools/test-tunnel-handshake-gate.sh (11 of 53) under
concurrent suites; it passes alone 53/53, the branch touches no tunnel file, and main has since merged
#4352's fix for that flake. The branch was then rebased on origin/main (clean) and the final validation
ran on the rebased head: 11251 pass, 0 fail; its hash is this proof's diff_hash.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above (ITER_COMMITS was empty)
- [WARNING] engine/create.js:878 comment said the switch was AGENT_WORKFORCE_MUSE=1 only --> FIXED (points at musestatus.enabled)
- [WARNING] server.js:8316 same --> FIXED
- [WARNING] web/index.html:12174/22605/26388 same --> FIXED
- [WARNING] bin/agent-supervisor.sh:64 same --> FIXED
- [NIT] docs/browser-checks/README.md row "behind AGENT_WORKFORCE_MUSE" --> FIXED
- [NIT] engine/musestatus.js comment said "this board's data folder" / "one computer" --> FIXED (the Kosmos data folder, store.ROOT)
- [NIT] plan: the marker path under an AGENT_WORKFORCE_DATA override --> FIXED
- [NIT] enabled() reads store.ROOT through its getter --> FIXED (comment on why it is read at call time)
Found by me in the same pass: the create form's comment said the flag is read at board start --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html museCreateAsk kept a switched-off answer for the page's life, so a marker created with the page open never showed in the Create form --> FIXED (asked again after MUSE_OFF_RECHECK_MS, 60 s; node test with a fresh-off control; reverting to the old rule reds it)
- [NIT] PREVIEW_MARKER exported with no reader --> FIXED (the test asserts against it)
- [NIT] no comment on why the file name was chosen --> left (the name says what it does)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 2 of the above (both in iteration 2's own test lines)
- [WARNING] web.muse-create-3939.test.js held its own copy of the recheck window --> FIXED (slices the page's MUSE_OFF_RECHECK_MS; setting it to 0 reds the test)
- [WARNING] web.muse-create-3939.test.js name and header said "not asked again" --> FIXED
- [NIT] README row "not asked again" --> FIXED
- [NIT] engine/create.test.js comment env-only --> FIXED
- [NIT] recheck runs on a paint, not a timer --> FIXED (one clause)
- [NIT] enabled() may run store's one-time migration --> FIXED (comment)
- [NIT] no operator-facing doc for the marker --> left (the one line goes to Josh through Splinter)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
**Converged** - no new actionable findings.
- [NIT] the try/catch around existsSync is dead (existsSync does not throw); kept: previewMarker() resolving store.ROOT can throw on a non-absolute data root
- [NIT] previewMarker's comment is dense

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/create.js:878 | BRANCH | env-only comment | FIXED | iteration 1 commit |
| 2 | 1 | WARNING | server.js:8316 | BRANCH | env-only comment | FIXED | iteration 1 commit |
| 3 | 1 | WARNING | web/index.html:12174 | BRANCH | env-only comments (3) | FIXED | iteration 1 commit |
| 4 | 1 | WARNING | bin/agent-supervisor.sh:64 | BRANCH | env-only comment | FIXED | iteration 1 commit |
| 5 | 2 | WARNING | web/index.html museCreateAsk | BRANCH | off kept for the page's life | FIXED | iteration 2 commit |
| 6 | 3 | WARNING | web.muse-create-3939.test.js | SELF | test's own copy of the window | FIXED | iteration 3 commit |
| 7 | 3 | WARNING | web.muse-create-3939.test.js | SELF | stale test name and header | FIXED | iteration 3 commit |

### NITs (non-blocking, across all iterations)
- file-name rationale comment (2); operator-facing doc (3); dead-looking try/catch (4, kept for the throwing path); dense comment (4)

### Strengths (across all iterations)
- Every reader of the switch goes through musestatus.enabled, so one change covers create, discovery, sign-in, /api/muse and the accounts row (1, 2, 4)
- The marker path follows the AGENT_WORKFORCE_HOME / _DATA seams; the test asserts it is inside the sandbox before writing (1, 3, 4)
- Fails closed: off a Mac the store is never read; a bad data root reads as off (1, 3)
- Each new test was shown to fail with its fix removed
