---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0800
diff_hash: a42be6ae134e09374f42a9622f09d5134305b9071dfd4d58477d53eb0e6ab8f2
validation: passed (Mortals)
subdir_audit: passed
timestamp: 2026-11-09T00:19:51Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes
**Total findings:** 14 (0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, 9 NITs)
**Fixed:** 4 | **Deferred:** 1 | **Asked (awaiting user):** 0

**Validation, stated exactly.** The full suite ran ONCE, at convergence, on Mortals (entry status clean, hash a42be6ae134e,
28143 tests, 0 fail, 0 cancelled, base 1fd2fc2af4). Steps 6.0 and 6g did not run the full suite per iteration: this Mac runs
one suite at a time and another was running, and the change is data only. In their place every iteration that changed the
data ran tools/whats-new-pool.js build (byte-compared with the committed file) and tools/whats-new-check.js. The 6j helper
skipped on that clean entry, rc 0.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above (no loop commit existed yet)
- [WARNING] release/whats-new-pool.json:1371 - the title said "held question", another feature's name, and "reached" overclaimed --> FIXED (cdee215891)
- [WARNING] release/whats-new-pool.json:1383 - since 0.7.99 meant the default kosmos whats-new never shows the #8236 note --> FIXED (cdee215891)
- [WARNING] .claude/plans/whatsnew-0800.md:8 - the audit started at the 0.7.99 freeze though 0.7.99 had no pool PR --> FIXED (cdee215891, adds #8227's note)
- [NIT] release/whats-new-pool.json:1372 - "on its Tasks row" names a tab some people lack --> applied
- [NIT] release/whats-new-pool.json:1389 - "report show print" hard to parse --> applied
- [NIT] release/whats-new-pool.json:1380 - "do only what they are asked" states an instruction as fact --> applied
- [NIT] .claude/plans/whatsnew-0800.md:17 - #8250 missing from the table --> covered by the rewritten table
- [NIT] .claude/plans/whatsnew-0800.md:27 - the Windows prod reading had no time --> applied

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above (the citation had no line number, so BRANCH by rule)
**Duplicates of prior findings (confirmed resolved):** 0
- [WARNING] release/whats-new-pool.json - since 0.8.00 dates two items one version after they first shipped --> DEFERRED: the pool has one version field (engine/releasenotes.js:48), and iteration 1 showed the other value hides the note. The plan records the cost.
- [NIT] .claude/plans/whatsnew-0800.md - the Windows prod reading cannot be re-checked from the repo

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 1 of the above
**Duplicates of prior findings (confirmed resolved):** 1
- [WARNING] release/whats-new-pool.json:1408 - "never opens a file on a network drive" is false for a local link to a share (#8232, open) --> FIXED (e5e8120306). Kept as a narrower sentence: cli.task-files-win32-8227.test.js fails if a mapped network drive is opened.
- [NIT] .claude/plans/whatsnew-0800.md:30 - two plans named different versions for the same hand retire --> applied (e5e8120306)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
**Converged** - no new actionable findings.
- [NIT] release/whats-new-pool.json - "kosmos report show print" still reads like a typo
- [NIT] release/whats-new-pool.json - "and when you answered" could add "if you have"

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | release/whats-new-pool.json:1371 | BRANCH | Title named another feature | FIXED | cdee215891 |
| 2 | 1 | WARNING | release/whats-new-pool.json:1383 | BRANCH | since hid the #8236 note | FIXED | cdee215891 |
| 3 | 1 | WARNING | .claude/plans/whatsnew-0800.md:8 | BRANCH | Audit window too short | FIXED | cdee215891 |
| 4 | 2 | WARNING | release/whats-new-pool.json | BRANCH | since dates two items late | DEFERRED | One version field; cost in the plan |
| 5 | 3 | WARNING | release/whats-new-pool.json:1408 | SELF | "never" overclaims, see #8232 | FIXED | e5e8120306 |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] release/whats-new-pool.json - "kosmos report show print" still reads like a typo (iteration 4, left: the text was not reopened after convergence)
- [NIT] release/whats-new-pool.json - "and when you answered" could add "if you have" (iteration 4, left)
- [NIT] .claude/plans/whatsnew-0800.md - the Windows prod reading cannot be re-checked from the repo (iteration 2, left)

### Strengths (across all iterations)
- The built file is byte-identical to the tool's output, and the checks pass for both platforms (iterations 1 to 4)
- The plan accounts for every merged PR since the last pool items, with a reason for each (iterations 2 to 4)
