---
pre_challenge: true
method: challenge-loop
branch: hoverflake-5298
diff_hash: d48c06dfc16c3c877cb7907265f076ac1cfee19b5350c8734eb46834d15de82c
validation: passed (Mortals full suite, 15954 tests, 0 fail, 2026-10-06 14:13 CDT; local helper skipped on that clean entry)
subdir_audit: passed
timestamp: 2026-10-06T19:16:00Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 11 (0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 8 NITs)
**Fixed:** 5 | **Deferred:** 1 | **Asked (awaiting user):** 0

Note on 6.0: no local full suite (the shared Agent1s queue); the full suite ran once at convergence on Mortals (6j).
Each iteration ran docs/browser-checks/render-newlook-4470.js alone, headless, plus red controls. An earlier single
Opus review (before this loop) found the original gap (border read in a separate round-trip after confirming :hover),
fixed at 118e98232 (now cf313656a after the rebase); the committed control proved it red 9/9 through browser-checks.sh.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above (ITER_COMMITS empty)
- [WARNING] render-newlook-4470.js:581 - the fallback read is indistinguishable from "hover rule missing", and the ground arm passed vacuously with no hover (it compared the resting ground with itself; pre-existing) --> FIXED (5018a3a2d: listLook returns hoverSeen and both list arms require it; controls: never hovered -> both arms red; rule removed -> border arm red with hoverSeen true)
- [WARNING] render-newlook-4470.js:576 - the same-frame read is right only while .lrow has no transition --> FIXED (5018a3a2d: the comment names the assumption; a transition would fail red, never green)
- [NIT] :573 - hover errors swallowed with a 30 s default wait --> FIXED (2 s bound)
- [NIT] :575 - the gate keyed on the FIRST plain row --> FIXED (sel + ':hover' accepts whichever plain row is hovered)
- [NIT] plan - pre-rebase sha --> FIXED (4b60457ee names cf313656a)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] :575 - no guard that .lrow has no transition --> DEFERRED (duplicate of iteration 1's note): it fails safe (the border arm goes red, never green), and asserting the absence of a transition would be a new rule on product CSS, outside this card
- [NIT] x3 (pointer parked at 1,1; "probably" in the comment; the Off arm pays the loop's wait) --> no change
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | render-newlook-4470.js:581 | BRANCH | fallback indistinguishable; ground arm vacuous | FIXED | 5018a3a2d |
| 2 | 1 | WARNING | render-newlook-4470.js:576 | BRANCH | transition assumption unstated | FIXED | 5018a3a2d |
| 3 | 1 | NIT | render-newlook-4470.js:573 | BRANCH | unbounded hover wait | FIXED | 5018a3a2d |
| 4 | 1 | NIT | render-newlook-4470.js:575 | BRANCH | first-row gate | FIXED | 5018a3a2d |
| 5 | 1 | NIT | plan | BRANCH | pre-rebase sha | FIXED | 4b60457ee |
| 6 | 2 | WARNING | render-newlook-4470.js:575 | SELF | no transition guard | DEFERRED | fails safe; outside the card |

### Strengths (across all iterations)
- the wait gates on :hover only, never on the border under test, so a removed hover rule still reads red with its value (1, 2)
- failure paths are bounded and non-throwing (2 s hover, 1 s wait, fallback read) (2)
- the proof used a COMMITTED control after two uncommitted controls were found vacuous (1, 2)

### Validation at convergence
- Mortals full suite at 4b60457ee: 15954 tests, 15722 pass, 0 fail, 0 cancelled; entry status clean.
- Merged with origin/main as of 14:15 in a throwaway worktree: render-newlook-4470.js 301/301, all 6 list arms PASS.
