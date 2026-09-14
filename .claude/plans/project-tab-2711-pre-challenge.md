---
pre_challenge: true
method: challenge-loop
branch: project-tab-2711
diff_hash: 60d272ef883bd8912b95d0f54ac9b69bc688f38ebfa99c9d90b90a68959dbb7e
validation: passed
subdir_audit: passed
timestamp: 2026-09-11T00:21:05Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (no NEW actionable findings on iteration 3, after dedup)
**Total findings:** 11 (1 BLOCKER, 3 WARNINGs, 3 CONVENTIONs, 4 NITs)
**Fixed:** 7 | **Deferred:** 2 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 2 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above (ITER_COMMITS empty on the first review)
- [WARNING] web/index.html:4678,4684 — Dead `.composerhint` base CSS orphaned by item 9 --> FIXED (c2f6ff9d)
- [WARNING] web/index.html:10361 — Room-composer comment still said "the @ half of the hint ships now" --> FIXED (c2f6ff9d)
- [CONVENTION] .claude/plans/project-tab-2711.md — em dashes and arrows against the no-em-dash house rule --> FIXED (c2f6ff9d)
- [CONVENTION] (commits) — subjects not in the `<branch> -- <message>` form --> DEFERRED: no interactive rebase in this environment; the PR title complies and commits reference #2711
- [NIT] web/index.html:10856 — settings-page "Project members" label unchanged --> DEFERRED: a different surface from the card heading item 14 renamed
- [NIT] web.consolidated-match-mock.test.js:191 — hint-absence assertions had no presence control --> FIXED (c2f6ff9d, added #pj-post control)

#### Iteration 2
**Reviewer model:** sonnet (different model per 6a)
**New findings:** 1 BLOCKER, 1 WARNING, 1 CONVENTION, 2 NITs
**Self-generated:** 1 of the above (the plan-text WARNING was on a line authored by iteration 1's fix commit; it is a plan file, the designated place for reasoning, so corrected rather than deleted)
**Duplicates of prior findings:** the CONVENTION (commit format) and one NIT (settings label) deduplicated to iteration 1's DEFERRED entries
- [BLOCKER] docs/browser-checks/render-projects.js:1061 — `expect:'Files'` is a substring of the old "Files in this project", so item 13's rename had no discriminating regression check --> FIXED (113283f2, added exact heading-tag controls in server.test.js: >Files</h3> present, old heading tags absent)
- [WARNING] .claude/plans/project-tab-2711.md:20 — plan mischaracterized the files door (it appends a count "View All 42") --> FIXED (113283f2, corrected + flagged the count question for Josh)
- [NIT] web/index.html:10352 — a pre-existing comment used the generic word "composerhint" --> FIXED (113283f2, reworded to "a hint line")

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
**Converged** — no new actionable findings. Both NITs were "no change required" (a substring browser-check whose discrimination now rests on server.test.js, documented; and a stale failure-message string that keys on a CSS selector, not the message, so it is not broken).

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html:4678 | BRANCH | dead .composerhint CSS | FIXED | c2f6ff9d |
| 2 | 1 | WARNING | web/index.html:10361 | BRANCH | stale @-hint comment | FIXED | c2f6ff9d |
| 3 | 1 | CONVENTION | plans/project-tab-2711.md | BRANCH | em dashes/arrows | FIXED | c2f6ff9d |
| 4 | 1 | CONVENTION | (commits) | BRANCH | commit-subject format | DEFERRED | no interactive rebase; PR title complies |
| 5 | 1 | NIT | web/index.html:10856 | BRANCH | settings label unchanged | DEFERRED | different surface |
| 6 | 1 | NIT | web.consolidated-match-mock.test.js:191 | BRANCH | vacuous absence assertion | FIXED | c2f6ff9d |
| 7 | 2 | BLOCKER | docs/browser-checks/render-projects.js:1061 | BRANCH | Files rename had no discriminating check | FIXED | 113283f2 |
| 8 | 2 | WARNING | plans/project-tab-2711.md:20 | SELF | plan mischaracterized files-door count | FIXED | 113283f2 |
| 9 | 2 | CONVENTION | (commits) | BRANCH | commit format (dup of #4) | DEFERRED | dup |
| 10 | 2 | NIT | web/index.html:10856 | BRANCH | settings label (dup of #5) | DEFERRED | dup |
| 11 | 2 | NIT | web/index.html:10352 | BRANCH | generic "composerhint" wording | FIXED | 113283f2 |

### Outstanding questions (ASKED, still unresolved when the run ended)
None. (One design note for Josh, not blocking: whether item 12's "just the text View All" means the files-door file count should be removed too. Left as-is, it is a tested deliberate feature; recorded in the plan and the card status, not an ASKED finding.)

### NITs (non-blocking, across all iterations)
- [NIT] web/index.html:10856 — settings-page "Project members" label (deferred: different surface)
- [NIT] docs/browser-checks/render-projects.js:1061 — substring expect:'Files' (adequate; discrimination in server.test.js)
- [NIT] web.consolidated-match-mock.test.js:90 — stale failure-message prose (harmless; assertion keys on a CSS selector)

### Strengths (across all iterations)
- Tests and browser-checks updated in genuine lockstep; the "no count" negative guards kept working can-fail controls.
- `.pj-viewall` underline/centre override is specificity- and source-order-safe, scoped to the two doors, and safe against the global `[hidden]{display:none!important}`.
- Composer-hint removal is clean at runtime: no dangling id/class/JS references; the @ picker affordance survives.
- The renamed-heading discriminating controls (added iteration 2) genuinely fail on a regression to the old copy, keyed on the heading tag rather than the bare phrase.
- No em dashes introduced anywhere in the diff.
