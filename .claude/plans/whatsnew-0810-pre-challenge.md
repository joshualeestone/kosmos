---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0810
diff_hash: 38a3bf4676991e4e0f2fe0fd8fe9107982099f6c660012914b85bbddc435c580
validation: passed (Mortals, 29,778 node tests 0 fail, 4 shell shards all passed)
subdir_audit: passed (no subdir CLAUDE.md changed)
timestamp: 2026-11-18T15:08:48Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes
**Total findings:** 13 (0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 9 NITs)
**Fixed:** 4 WARNINGs, 6 NITs | **Deferred:** 0 | **Asked (awaiting user):** 0

Note on order: the full-suite validation ran once, on Mortals, after convergence (one suite per Mac). The change is data only (the pool, the tool-built web/whats-new.json, the plan); each round's build was checked by the tool's own engine/whatsnew.js rules, which refuse an invalid window and write nothing.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] release/whats-new-pool.json (Windows leftover line) — "works from the agent's folder" reads as the working folder, the one case #8686 does not cover --> FIXED (98ba2759a3)
- [WARNING] release/whats-new-pool.json (wake line) — no condition for a pull request or branch wake --> FIXED (98ba2759a3)
- [NIT] release/whats-new-pool.json (#8668 line) — omits the task page's half --> FIXED (98ba2759a3)
- [NIT] .claude/plans/whatsnew-0810.md — weakest premise omits the no-holder case --> FIXED (98ba2759a3)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings (confirmed resolved):** 1 (the wake condition)
- [WARNING] release/whats-new-pool.json (edit line) — "records what changed" is false for a detail (only "changed the detail") --> FIXED (8ff257b58a)
- [NIT] .claude/plans/whatsnew-0810.md — #8659's no-line reason unstated --> FIXED (8ff257b58a)
- [NIT] wake title says "a merge" though a PR closed unmerged also wakes --> left
- [NIT] no-model line simplifies where the link shows --> left

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] release/whats-new-pool.json (wake line) — "with GitHub connected" is false for a GitHub connection made through Kosmos's own sign-in; the wake reads only the gh tool (server.js wakeGh) --> FIXED (ebb04f5d43); the engine's refusal text has the same gap, commented on #8669
- [NIT] edit line implies old and new detail words --> FIXED (ebb04f5d43)
- [NIT] agent model line: some vendors have no list --> FIXED (ebb04f5d43)
- [NIT] plan: #8685 folded into the Windows line unstated --> FIXED (ebb04f5d43)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Converged** — no new actionable findings.
- [NIT] "the gh tool" is technical for a person --> left (the honest condition)
- [NIT] the signed-out note also shows for a lapsed relay sign-in --> left
- [NIT] task edit notes line's agent limit applies to an identified agent --> left

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | release/whats-new-pool.json | BRANCH | Windows line "works from" overclaims | FIXED | 98ba2759a3 |
| 2 | 1 | WARNING | release/whats-new-pool.json | BRANCH | wake line lacks its condition | FIXED | 98ba2759a3 |
| 3 | 2 | WARNING | release/whats-new-pool.json | BRANCH | edit line overclaims for a detail | FIXED | 8ff257b58a |
| 4 | 3 | WARNING | release/whats-new-pool.json | BRANCH | "with GitHub connected" false for Kosmos sign-in | FIXED | ebb04f5d43 |

### NITs (non-blocking, across all iterations)
- #8668 line omitted the page half (iteration 1, fixed)
- weakest premise no-holder case (iteration 1, fixed)
- #8659 no-line reason (iteration 2, fixed)
- wake title "a merge" (iteration 2, left)
- no-model link placement simplified (iteration 2, left)
- edit line detail words (iteration 3, fixed)
- agent model list availability (iteration 3, fixed)
- #8685 folding stated (iteration 3, fixed)
- three iteration 4 NITs above (left)

### Strengths (across all iterations)
- Bookkeeping exact: the five marked shown are the five in web/whats-new.json at 0.8.09's freeze 7c2d1f1376; lastProd 0.8.09 (every round).
- Every new line checked against its merged code; CLI verbs present in both install/kosmos and tools/windows/kosmos-cli.js, so untagged notes lines are right.
- Coverage of all 67 commits since 7c2d1f1376 complete; no em dash in any spelling.
