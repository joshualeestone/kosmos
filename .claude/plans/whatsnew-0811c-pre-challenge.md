---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0811c
diff_hash: 705b70f48a8d0b03a7d750420f55add8268958176cf5bb8d2fbe151fcd628d02
validation: passed (Mortals)
subdir_audit: passed
timestamp: 2026-11-19T22:18:35Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes
**Total findings:** 5 actionable (1 BLOCKER, 3 WARNINGs, 0 CONVENTIONs) plus 8 NITs
**Fixed:** 4 | **Deferred:** 0 | **Asked (awaiting user):** 0 | **Confirmed resolved (duplicates):** 2

Data only: one What's New pool entry for #8728 part 2, the rebuilt web/whats-new.json, and the plan. Validation: the full suite on Mortals for this exact hash (30,065 node tests, 0 failed, 0 cancelled; shell shards 83, 75, 78, 80, all passed; entry "status":"clean", base e60feee681). Locally: the five What's New test files, 60 tests, 0 failed. Between iterations 2 and 3 the branch was rebased onto main for #8759 (e60feee681), and the line was changed, which is why the loop ran two more passes after its first convergence.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above
- [BLOCKER] release/whats-new-pool.json:2429: the untagged line "opens no browser on the far computer" was false on Windows: engine/connect.js:1625 on main computed remoteStarted false on win32, so a remote sign-in still opened a tab there until #8759 --> FIXED (b9920be64c, mac tag and "a far Mac")
- [WARNING] .claude/plans/whatsnew-0811c.md:15: the plan restated the same premise from #8744's title --> FIXED (b9920be64c)
- [NIT] release/whats-new-pool.json:2429: "after a Kosmos+ sign-in" read as any sign-in --> taken (b9920be64c)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 new WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings (confirmed resolved):** 1 (re-check #8759 at the pin: the plan's rule)
- [NIT] .claude/plans/whatsnew-0811c.md: the local-run line gave a Windows count from before the mac tag --> taken (a8da95f909)
- [NIT] web/whats-new.json:6: the dialog-return wording omits #8755's guards (weakest premise)
- [NIT] release/whats-new-pool.json: Starring leaves the window (by rank, stays pending)
**Converged**: no new actionable findings.

#### After convergence: #8759 merged (e60feee681)
Rebased onto main; the tag dropped and the line returned to "the far computer" (387810f595), at Splinter's 15:10 ask. Because user-facing words changed, the loop resumed.

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above (the cited clause predates the loop's fixes in substance; classified BRANCH)
- [WARNING] release/whats-new-pool.json:2429: "its dialog returns" read as every remote sign-in, but the return note is written only for Sign in again (web/index.html, `out.signInAgain === true && reauthDir`) --> FIXED (2ba0aa2b5a, the clause names Sign in again)
- [NIT] .claude/plans/whatsnew-0811c.md:11: "15:0x" placeholder --> taken (2ba0aa2b5a, 15:09 from gh pr view 8759)
- [NIT] .claude/plans/whatsnew-0811c.md:10: the cited slice shas are rebase-merged PRs' last commits (ancestry only)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 new WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings (confirmed resolved):** 1 (the 0.8.11 pin must include e60feee681: the plan's rule)
- [NIT] web/whats-new.json:6: the dialog clause omits the 10-minute and same-tab guards (weakest premise, 140-character limit)
- [NIT] .claude/plans/whatsnew-0811c.md: the plan cites connect.js:1625 for code since removed (history)
**Converged**: no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | release/whats-new-pool.json:2429 | BRANCH | untagged line false on Windows before #8759 | FIXED | b9920be64c, then 387810f595 once #8759 merged |
| 2 | 1 | WARNING | .claude/plans/whatsnew-0811c.md:15 | BRANCH | plan restated the #8744-title premise | FIXED | b9920be64c |
| 3 | 2 | WARNING | web/whats-new.json:6 | BRANCH | re-check #8759 at the pin | FIXED | duplicate of 1; plan rule, then 387810f595 |
| 4 | 3 | WARNING | release/whats-new-pool.json:2429 | BRANCH | dialog clause wider than #8755 (Sign in again only) | FIXED | 2ba0aa2b5a |
| 5 | 4 | WARNING | web/whats-new.json:6 | BRANCH | the pin must include e60feee681 | FIXED | duplicate of 3; plan rule |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] dialog-return wording omits #8755's 10-minute and same-tab guards (iterations 2, 4; the plan's weakest premise)
- [NIT] Starring an agent shines leaves the window by rank and stays pending (iteration 2)
- [NIT] the cited slice shas are rebase-merged PRs' last commits, ancestry only (iteration 3)
- [NIT] the plan cites connect.js:1625 for code #8759 removed (iteration 4, history)

### Strengths (across all iterations)
- The line was checked against the code on every platform it is shown on, not against PR titles (iterations 3, 4)
- The plan names its weakest premise and what would change its mind; the premise it named was the one that proved wrong (iteration 1)
- The window is rebuilt by the tool and passes whats-new-check.js for mac (5) and windows (4) (iterations 1 to 4)
