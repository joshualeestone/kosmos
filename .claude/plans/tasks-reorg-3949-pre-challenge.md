---
pre_challenge: true
method: challenge-loop
branch: tasks-reorg-3949
diff_hash: ef3d6c02e8bf7acf5b77449bc6fec46dd585fdda2393a1026d8e8b3f26591368
validation: passed
subdir_audit: passed
timestamp: 2026-09-26T15:16:59Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (6 before the rebase onto origin/main a4007bb, 2 after)
**Converged:** Yes (iteration 8 raised only the already-deferred overcount WARNING and NITs)
**Total findings:** 33 (3 BLOCKERs, 14 WARNINGs, 3 CONVENTIONs, 21 NITs; counts include the two validation-gate failures after round 1)
**Fixed:** 25 | **Deferred:** 8 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/tasks.js waitingOnPerson: only claimWho was checked, so a second holder's question missed --> FIXED (3f1ca30)
- [WARNING] web/index.html decision why-line omitted a given-up connection --> FIXED (3f1ca30)
- [WARNING] web/index.html: Tasks view did not re-read when WHO needs the person changed --> FIXED (3f1ca30)
- [NIT] Completed fold stayed open after un-picking its tile --> FIXED (3f1ca30)
- [NIT] stale "Assigned, not started" in a comment --> FIXED (3f1ca30)
- [NIT] PROJECT vs CREATED: label punctuation --> DEFERRED: Josh's label; Mona's design review
- [NIT] in-function require --> commented (3f1ca30)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 2 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT (the two BLOCKERs are also the validation failures after iteration 1)
**Self-generated:** 2 of the above (the browser check and the tests this loop wrote)
- [BLOCKER] docs/browser-checks/render-tasks-view-3559.js named the removed #tsk-projects (browser-checks-selectors guard) --> FIXED (91e229d)
- [BLOCKER] engine/tasks.state-3559.test.js, web.tasks-view-3559.test.js hand-built roster cards (fixture-discipline guard) --> FIXED (91e229d)
- [WARNING] tskNeedsSig repeats needsPerson --> commented (91e229d)
- [NIT] why non-question needs skip the project check --> commented (91e229d)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 4 NITs
**Self-generated:** 1 of the above
- [WARNING] server.tasks-tab-3559.test.js / render check stubbed waitingOnPerson; the real rule was never run end to end --> FIXED (06b1eb0): real asking agents
- [NIT] needs baseline set after the read, not at it --> FIXED (06b1eb0)
- [NIT] a zero Needs Your Decision drawn red --> FIXED (06b1eb0)
- [NIT] re-read signature counted untied panes --> FIXED (06b1eb0)
- [NIT] repaints rewrote open dropdowns --> FIXED (06b1eb0)
- [CONVENTION] label punctuation --> DEFERRED (as iteration 1)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] CLAUDE.md "Where to Find Things" row listed four states --> FIXED (078b014)
- [NIT] 480px threshold unexplained --> commented (078b014)
- [NIT] render-alltasks rebuilt a function from source --> FIXED (078b014)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [BLOCKER] docs/browser-checks/render-subtasks-3861.js matched /Closed/ on the renamed fold --> FIXED (e1c2486): reads the fold element
- [WARNING] needs baseline advanced while busy, so a question during a bulk close was missed --> FIXED (e1c2486)
- [WARNING] third copy of needsPerson on the page --> DEFERRED: the page inlines it in seven painters on purpose (#3410)
- [NIT] "about this project" on All tasks --> FIXED (e1c2486)
- [NIT] knownIds not applied to stateProject --> noted (same result for a task's own project)
- [NIT] plan did not list the affected checks --> FIXED (e1c2486)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Converged:** no new actionable findings.
- [NIT] web.tasks-view-3559.test.js: one failure message reads "is still red" where it means "not red"
- [NIT] web/index.html: the tsk-toprow children are not indented one level
- [NIT] no assertion in the 761-1000px band

#### Iteration 7 (after the rebase onto origin/main a4007bb)
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 1 of the above
- [WARNING] Needs Your Decision counts tasks, not questions (one question can show as several) --> DEFERRED: the project page's granularity, keeps the tiles summing to the open count; recorded on #3949 for Mona's review
- [WARNING] a zero decision tile kept a red dot (inline --tsk-c beat the CSS) --> FIXED (d6c646f): neutral dot at zero; the browser check's zero arm reds with the old painter
- [NIT] tskOptions comment overclaimed --> FIXED (d6c646f)
- [NIT] tskNeedsSig used isNamedOurs !== false --> FIXED (d6c646f): === true, as the server
- [NIT] stale "rail item" header and palette comment --> FIXED (d6c646f)
- [NIT] forced-open Completed fold reopens on a repaint --> DEFERRED: follows from the design
- [CONVENTION] label casing and punctuation --> DEFERRED (Mona's review)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 new WARNINGs, 0 CONVENTIONs, NITs only
**Converged:** the one WARNING raised was iteration 7's deferred overcount (deduplicated); no new actionable findings.

### Final validation (6j)
- First run: one unrelated test (tools.plus-signin-2036, a timeout) failed under load; it passes 18/18 alone.
- Second and third runs: the browser-check surface gate flagged render-chip-filters-3423.js for a `data-attn` token. The only change is a comment. That check was re-run headless (20 pass) and excused with a per-check trailer (ac5ff2e; the first trailer, ffab89d, omitted `.js`).
- Pre-rebase final run on ac5ff2e: PASSED (hash cb009ecffb47), subdir audit passed.
- Post-rebase final run on d6c646f: PASSED (validation rc=0, subdir audit rc=0), 2026-09-26 10:13 CDT. origin/main has since moved 8 commits with no conflict (merge-tree clean), so the three-dot diff and this hash are unchanged.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/tasks.js waitingOnPerson | SELF | first holder only | FIXED | 3f1ca30 |
| 2 | 1 | WARNING | web/index.html TSK_GROUPS | SELF | why-line incomplete | FIXED | 3f1ca30 |
| 3 | 1 | WARNING | web/index.html tskRosterChanged | SELF | no live re-read | FIXED | 3f1ca30 |
| 4 | 2 | BLOCKER | render-tasks-view-3559.js:124 | SELF | removed id named | FIXED | 91e229d |
| 5 | 2 | BLOCKER | tests (cards) | SELF | hand-built cards | FIXED | 91e229d |
| 6 | 2 | WARNING | web/index.html tskNeedsSig | SELF | copy of needsPerson | FIXED | 91e229d (comment) |
| 7 | 3 | WARNING | server.tasks-tab-3559.test.js | SELF | rule stubbed | FIXED | 06b1eb0 |
| 8 | 3 | CONVENTION | web/index.html labels | BRANCH | punctuation | DEFERRED | Mona's review |
| 9 | 4 | WARNING | CLAUDE.md:83 | BRANCH | stale row | FIXED | 078b014 |
| 10 | 5 | BLOCKER | render-subtasks-3861.js:95 | BRANCH | /Closed/ match | FIXED | e1c2486 |
| 11 | 5 | WARNING | web/index.html tskRosterChanged | SELF | busy baseline | FIXED | e1c2486 |
| 12 | 5 | WARNING | web/index.html tskNeedsSig | SELF | third copy | DEFERRED | #3410 painters inline |
| 13 | 7 | WARNING | engine/tasks.js waitingOnPerson | SELF | counts tasks not questions | DEFERRED | Mona's review (#3949) |
| 14 | 7 | WARNING | web/index.html tile painter | SELF | red dot at zero | FIXED | d6c646f |

### Outstanding questions (ASKED, still unresolved when the run ended)
- none

### NITs (non-blocking, across all iterations)
- label punctuation (1, 3); knownIds note (5); failure-message wording, markup indentation, 761-1000px band (6)

### Strengths (across all iterations)
- Every tile count comes from engine state, and Built but waiting is left out (#3951) rather than guessed (all iterations)
- The real rule is exercised end to end with real asking agents, and every fix has a mutation that turns its test red (3 to 6)
- Browser checks run headless before and after on the same fixture: tasks-view 147, alltasks 29, subtasks 49, render-tasks OK, chip-filters 20
