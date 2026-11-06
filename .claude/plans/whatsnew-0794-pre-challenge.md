---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0794
diff_hash: 2ea7345deff135a6cbc1744c26f9996f146fe924c8a68ce58fad3a942147adb5
validation: passed (Mortals full suite, 27569 tests, 0 fail, entry clean for this hash, base d6a63933cb)
subdir_audit: passed
timestamp: 2026-11-06T14:45:35Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3 raised NITs only)
**Total findings:** 3 actionable (0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs), 6 NITs
**Fixed:** 3 | **Deferred:** 0 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] release/whats-new-pool.json join-code line: claimed the domain refusal used to say "try again"; it had its own sentence. --> FIXED: the line names only the address and no-free-seat cases for "instead of asking you to try again".
- [WARNING] release/whats-new-pool.json kept-form line: "Back from Settings within 30 minutes" had no starting point and was broader than the code (kept only after the refusal's link). --> FIXED: "If Create agent sends you to Settings to connect a model, ...".
- [NIT] "suggestion" is the code's word --> FIXED: the clause dropped.
- [NIT] family invites too --> left: it undersells.

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 1 of the above (the WARNING cites iteration 1's rewording, a prose claim; narrowed, not expanded)
- [WARNING] "keeps any name you typed": a typed name equal to the last suggestion is treated as one. --> FIXED: "a name you typed".
- [NIT] the kept-form line's condition --> already covered by its "If Create agent sends you to Settings".

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
- [NIT] the 30-minute keep was already in 0.7.93; the new part is the sentence and Start over --> left: the title says the new part.
- [NIT] "a company with no free seat" says more than the board's own sentence --> left: pilots are company-only.
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | release/whats-new-pool.json join codes | BRANCH | domain case claimed as new | FIXED | iteration 1 commit |
| 2 | 1 | WARNING | release/whats-new-pool.json kept form | BRANCH | no starting point, broader than code | FIXED | iteration 1 commit |
| 3 | 2 | WARNING | release/whats-new-pool.json short names | SELF | "any name" stronger than code | FIXED | iteration 2 commit |

### NITs (non-blocking, across all iterations)
- Family invites also get the new words (iteration 1): undersold, left.
- The 30-minute keep predates 0.7.94 (iteration 3): the title names the new part.
- "company" for the pilot case (iteration 3): pilots are company-only.

### Strengths (across all iterations)
- The built web/whats-new.json is byte-identical to the tool's output (every iteration).
- The four 0.7.93 highlights are marked shown exactly; the Windows-only item stays pending as the pool's rule says.
- No em dash in any of five spellings; lengths within limits; unique titles.
