---
pre_challenge: true
method: challenge-loop
branch: issuechip-8592
diff_hash: b7f53c4f5cbca8c69d6fad448d9932d5944bca26ff549a320d6fb58937471443
validation: passed
subdir_audit: passed
timestamp: 2026-11-16T22:40:38Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6 (blind reviews; the 6.0 baseline validation was deferred to convergence by my standing rule "full validation once, at convergence", and the full suite then ran at each convergence, failing twice and passing on the final head)
**Converged:** Yes (iteration 6, no new BLOCKER/WARNING/CONVENTION; two models in the rotation, opus and sonnet)
**Total findings:** 17 actionable or recorded (1 BLOCKER, 8 WARNINGs, 1 CONVENTION, plus 3 final-validation BLOCKER groups), NITs listed below
**Fixed:** 12 | **Deferred:** 5 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html:2859 — a folded parent hid a marked sub-project under the filter --> FIXED (811d314209)
- [WARNING] web/index.html:71337 — the filter class reached the consolidated rail, which has no tile to undo it --> FIXED (811d314209)
- [NIT] web/index.html:71345 — title wrong while pressed at count 1 --> taken (811d314209)
- [NIT] web/index.html:71175 — stripe counted hidden rows --> taken (811d314209)
- [NIT] web/index.html:2864 — fold carets show under the filter --> taken (811d314209)
- [NIT] render-pj-issue-tile-8592.js:136 — fixed 1200 ms server wait, as siblings

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Converged** (first time). The final validation then failed:
- [BLOCKER] final-validation: browser-checks-reason-grep (no SITE_COUNTS line) and teardown-guard-6022 (route handler outside a try) --> FIXED (777d5799b0)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [BLOCKER] server.test.js:7749 — the projects-tiles slice anchored on the replaced line --> FIXED (e10a942e21)
- [WARNING] render-pj-issue-tile-8592.js:96 — detailShown read a non-existent #pj-detail --> FIXED (e10a942e21, reads #pj-one-view)
- [WARNING] web/index.html:17493 — aria-pressed on a tile that opens rather than toggles at count 1 --> FIXED (e10a942e21, pjAttnTileSync)
- [NIT] web/index.html:71321 — a failed read drops the filter --> DEFERRED: decided, the tile hides and could not undo it
- [NIT] check 2c fakes consolidated by hand --> comment added (e10a942e21)
- [NIT] plan Checks section --> updated

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html:71361 — count dropping 2 to 1 while filtered leaves a pressed toggle --> DEFERRED: the design; the reviewer called it not a defect, and a click on the pressed tile also clears it (pjAttnTileClick)
**Converged** (second time). The final validation then failed:
- [BLOCKER] final-validation: web.tasks-cap-1193 (no "Show all" label), web.roadmap-twoview-3276 (pinned treeMode line), shell surface gate (7 mapped checks) --> FIXED (561932ef80: "View all projects", pinned lines restored, each mapped check run and passing with a per-check trailer)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above (the fold stand-down added in 811d314209 left pjFoldAll able to save a fold unseen)
- [WARNING] web/index.html:71212 — Collapse all under the filter saved a fold unseen --> FIXED (2d170de095, pjFoldFrozen, strip buttons hidden)
- [NIT] web/index.html:71344 — unused tile variable --> taken (2d170de095)
- [NIT] web/index.html:69834 — comment claimed an id order the code does not have (SELF prose) --> claim deleted (2d170de095)
- [NIT] exit link drops focus, as the Agents twin does
- [NIT] Grid-irrelevant !important rules

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs (both deferred as decided), 1 CONVENTION (trailers honest: a confirmation, no action), 3 NITs
**Self-generated:** 0 of the above
- [WARNING] filter survives a trip to the consolidated rail --> DEFERRED: decided in the plan; the exit link shows again on return
- [WARNING] no live announcement of the filtered count --> DEFERRED: matches the Agents twin (#3423); a shared announcement is a separate change
**Converged** — no new actionable findings. Final validation passed on this head (29323 tests, 0 fail; audit passed).

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html:2859 | BRANCH | fold hid a marked sub-project | FIXED | 811d314209 |
| 2 | 1 | WARNING | web/index.html:71337 | BRANCH | filter leaked into consolidated | FIXED | 811d314209 |
| 3 | 2 | BLOCKER | final-validation | BRANCH | SITE_COUNTS line, route try | FIXED | 777d5799b0 |
| 4 | 3 | BLOCKER | server.test.js:7749 | BRANCH | slice anchored on replaced line | FIXED | e10a942e21 |
| 5 | 3 | WARNING | render-pj-issue-tile-8592.js:96 | BRANCH | detailShown read a missing id | FIXED | e10a942e21 |
| 6 | 3 | WARNING | web/index.html:17493 | BRANCH | aria-pressed when it opens | FIXED | e10a942e21 |
| 7 | 4 | WARNING | web/index.html:71361 | BRANCH | 2 to 1 while filtered | DEFERRED | design; tile click clears |
| 8 | 4 | BLOCKER | final-validation | BRANCH | Show all label, pinned lines, surface gate | FIXED | 561932ef80 |
| 9 | 5 | WARNING | web/index.html:71212 | SELF | fold saved unseen under filter | FIXED | 2d170de095 |
| 10 | 6 | WARNING | web/index.html:71347 | BRANCH | filter kept across consolidated | DEFERRED | decided in plan |
| 11 | 6 | WARNING | web/index.html:71337 | BRANCH | no live count announcement | DEFERRED | matches Agents twin |

### NITs (non-blocking, across all iterations)
- [NIT] render-pj-issue-tile-8592.js:136 — fixed 1200 ms server wait, as its siblings (iteration 1)
- [NIT] web/index.html:71346 — typeof guard on a hoisted function (iterations 2, 6)
- [NIT] web/index.html:2863 — several !important overrides depend on tree selectors staying put (iterations 2, 4)
- [NIT] web/index.html:71372 — "View all projects" drops focus to body, as "View all agents" does (iteration 5)
- [NIT] web/index.html:2857 — two filter rules do nothing in Grid (iteration 5)
- [NIT] web/index.html:71336 — the new pjNeedsPerson block sits between pjPillOf and its doc comment (iteration 6)

### Strengths (across all iterations)
- One predicate, pjNeedsPerson, drives the tile count, the row marker and the click, so the filter cannot disagree with the count.
- The filter turns itself off whenever the tile would hide (zero, or an unreadable roster), so it can never be left on with no way out.
- The browser check has controls that can come out the other way, each new assertion was shown to fail on the commit before its fix, and it runs in Roadmap and Grid with a ran-count floor.
- Every Browser-check-surface trailer names a check that was run on the commit and passed.
