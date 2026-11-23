---
pre_challenge: true
method: challenge-loop
branch: agentbrowser-peragent-8928
diff_hash: 122f726de328e4344891682fa9a8e52a438989f0393a66b64462bbfa04955a83
validation: passed
subdir_audit: passed
timestamp: 2026-11-23T13:13:25Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes (iteration 5: zero NEW findings after deduplication, no ASKED findings)
**Total findings:** 17 (0 BLOCKERs, 17 WARNINGs, 0 CONVENTIONs; NITs listed below)
**Fixed:** 11 | **Deferred:** 6 | **Asked (awaiting user):** 0

Initial validation (6.0): all commands passed, recorded superseded because iteration 1 committed while it ran (kosmos#6126). Each iteration ran agentbrowser.test.js and win32supervisor.test.js under tools/run-tests.sh --only plus tools/test-supervisor-agentbrowser-3633.sh. Closing validation (6j) passed on 8f683ab5af (node part 30,689 tests, 0 fail; shell part green).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/agentbrowser.js:121: two agents could share one file (case, or names that clean to the same text) --> FIXED (c36392f8c3, lowercase key plus a hash of the original name when cleaning changed it)
- [WARNING] engine/agentbrowser.js:121: Windows device names (con, nul) would cost the browser --> FIXED (c36392f8c3)
- [WARNING] engine/agentbrowser.js:125: per-agent write failure returns null --> DEFERRED: the hash removes the naming causes; other write failures would hit the shared file too
- [WARNING] engine/agentbrowser.test.js:121: Windows default wiring untested --> FIXED (c36392f8c3, browserFor)
- [WARNING] engine/agentbrowser.test.js:130: hostile-name test could not catch collisions --> FIXED (c36392f8c3, 17 names, 17 keys; removing the hash turns it red)

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/win32supervisor.js:286: main() itself not guarded --> FIXED (3c12805407, agentBrowserModule seam; reverting main() turns it red)
- [WARNING] engine/agentbrowser.test.js:239: the #8929 shim arms only ran unnamed --> FIXED (3c12805407, named arms and a named control; removing the #8929 guard turns them red)
- [NIT] hashed key could equal a literal name --> taken (separator `~`)

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING (+2 duplicates), 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/agentbrowser.js:290: two-level output folder never created --> FIXED (1c60a0385e, launchConfig creates it; tests clean up after it)
- [WARNING] key stability across relaunches --> DEFERRED: slice 2's stated dependency
- [WARNING] per-agent leftovers --> DEFERRED: slice 2 or 3
- [NIT] duplicated comment header from iteration 2 --> taken

#### Iteration 4
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (the cleanup this loop added in iteration 3)
- [WARNING] engine/agentbrowser.js:285: a failed mkdir would cost the browser --> FIXED (d942d22f10, own catch)
- [WARNING] engine/agentbrowser.test.js:123: a direct run's cleanup removed live agents' output folders --> FIXED (d942d22f10, only its own test-named folders; parent only if empty)
- [WARNING] tools/test-supervisor-agentbrowser-3633.sh:81: TMPDIR scope not stated --> FIXED (d942d22f10)

#### Iteration 5
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs after deduplication, 1 CONVENTION (plan exists), 3 NITs
**Self-generated:** 0 of the above
- duplicates: leftovers of deleted agents; stable names --> DEFERRED (as before)
- [WARNING] a pruned output folder on a long-lived agent --> DEFERRED: not a regression, same as the shared folder before
- [NIT] an unverified sentence in the supervisor test's comment --> taken (deleted, 8f683ab5af)
**Converged**: no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/agentbrowser.js:121 | BRANCH | key collisions | FIXED | c36392f8c3 |
| 2 | 1 | WARNING | engine/agentbrowser.js:121 | BRANCH | Windows device names | FIXED | c36392f8c3 |
| 3 | 1 | WARNING | engine/agentbrowser.js:125 | BRANCH | write failure returns null | DEFERRED | hash removes naming causes |
| 4 | 1 | WARNING | engine/agentbrowser.test.js:121 | BRANCH | Windows default untested | FIXED | c36392f8c3 |
| 5 | 1 | WARNING | engine/agentbrowser.test.js:130 | BRANCH | weak hostile-name test | FIXED | c36392f8c3 |
| 6 | 2 | WARNING | engine/win32supervisor.js:286 | BRANCH | main() unguarded | FIXED | 3c12805407 |
| 7 | 2 | WARNING | engine/agentbrowser.test.js:239 | BRANCH | shim arms unnamed | FIXED | 3c12805407 |
| 8 | 3 | WARNING | engine/agentbrowser.js:290 | BRANCH | output folder not created | FIXED | 1c60a0385e |
| 9 | 3 | WARNING | engine/agentbrowser.js:121 | BRANCH | key stability | DEFERRED | slice 2 dependency |
| 10 | 3 | WARNING | engine/agentbrowser.js:395 | BRANCH | leftovers of deleted agents | DEFERRED | slice 2 or 3 |
| 11 | 4 | WARNING | engine/agentbrowser.js:285 | BRANCH | mkdir failure costs browser | FIXED | d942d22f10 |
| 12 | 4 | WARNING | engine/agentbrowser.test.js:123 | SELF | cleanup removed live folders | FIXED | d942d22f10 |
| 13 | 4 | WARNING | tools/test-supervisor-agentbrowser-3633.sh:81 | BRANCH | TMPDIR scope | FIXED | d942d22f10 |
| 14 | 5 | WARNING | engine/agentbrowser.js:286 | BRANCH | pruned output folder | DEFERRED | not a regression |

### NITs (non-blocking, across all iterations)
- [NIT] plan wording out of step with the code (iterations 1, 2, 3, 4), each taken
- [NIT] shim header did not mention the name argument (iteration 2), taken
- [NIT] inline crypto require (iteration 4), taken
- [NIT] the #8928 unit test leans on an earlier test's fake install, asserted (iteration 5)

### Strengths (across all iterations)
- A name can never leave the agents folder or the output parent, on Mac or Windows rules; distinct names never share a file (iterations 1 to 5)
- A bare launchConfig() keeps the shared file, so every existing caller is unchanged (iterations 1, 3, 5)
- Each new test can fail and has a control; mutations of the hash, the supervisor's name argument, main()'s wiring and the #8929 guard each turn their own check red (iterations 2, 4, 5)
