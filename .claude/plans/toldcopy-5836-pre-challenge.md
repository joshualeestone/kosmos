---
pre_challenge: true
method: challenge-loop
branch: toldcopy-5836
diff_hash: 3817b1d62a77d2cb5a53db0ac390fcc3c368bff0670b77592700f507612ce8c7
validation: passed
subdir_audit: passed
timestamp: 2026-10-11T13:49:15Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 7 (0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs)
**Fixed:** 2 | **Deferred:** 0 | **Asked (awaiting user):** 0

Process note, stated plainly: 6.0's full validation was not run before iteration 1. Per this
fleet's standing rule for the shared Mac (one full suite at a time), focused tests ran each round
(web.task-told-5836 5/5, web.task-repeat-4787 15/15, web.task-runrollup-5643 5/5) plus the
task-told-5836 mobile-shots screen (4 shots, its verify passing), and the full validation ran once
at 6j on the final HEAD: VAL rc=0, AUDIT rc=0, browser-check surface gate rc=0, 19,091 node tests
with 0 failing, EXIT=0.

Negative control, each round: web.task-told-5836.test.js against origin/main's page fails 4 of 5
(the 5th is the no-field control).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above (ITER_COMMITS empty)
- [WARNING] web/index.html:60918 — "You have not been told this yet." claims more than the data knows (told is only recorded by `kosmos task told`) --> FIXED (42b191727): "Kosmos has no record of you being told this."
- [WARNING] docs/browser-checks/mobile-shots.js:945 — the task-told-5836 screen comment still quoted the old sentence --> FIXED (42b191727)
- [NIT] docs/browser-checks/mobile-shots.js:968 — verify checked only the second half --> taken (42b191727): it now checks "Its latest check found … You were last told …"
- [NIT] web/index.html:60922 — "it was" had no clear antecedent --> taken (42b191727): "You were last told “Y” (when)."
- [NIT] web.task-told-5836.test.js:33 — the no-field control is fixture-dependent --> not taken (it guards the shipped fixture)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [NIT] web/index.html:60921 — the review-1 comment mentions "changed since", now historical --> not taken (it records why the branch exists)
- [NIT] web/index.html:60918 — "no record" reads slightly clinical --> not taken (the hedge is the point; recorded in the plan)
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html:60918 | BRANCH | Never-told sentence overclaims | FIXED | 42b191727 |
| 2 | 1 | WARNING | docs/browser-checks/mobile-shots.js:945 | BRANCH | Stale screen comment | FIXED | 42b191727 |

### NITs (non-blocking, across all iterations)
- [NIT] mobile-shots.js:968 — verify checks one half (iteration 1, taken)
- [NIT] web/index.html:60922 — unclear "it was" (iteration 1, taken)
- [NIT] web.task-told-5836.test.js:33 — fixture-dependent control (iteration 1)
- [NIT] web/index.html:60921 — historical "changed since" in a comment (iteration 2)
- [NIT] web/index.html:60918 — "no record" reads clinical (iteration 2)

### Strengths (across all iterations)
- Only the page sentences change; the CLI and server keep "reading" for agents, and the plan says why (iterations 1, 2)
- All four branches of tskToldSentence updated consistently; the told-after branch keeps its order-as-it-happened behaviour (iteration 1)
- Tests anchor the full new sentences and fail on the old (iterations 1, 2)
- The mobile-shots verify and the README row moved in the same change (iterations 1, 2)
