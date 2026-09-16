---
pre_challenge: true
method: challenge-loop
branch: fix-headrow-control-3128
diff_hash: 7ef92e877396dc97747ca45dfa922fb77d681633c02cefa8eb8134655cc33846
validation: passed
subdir_audit: passed
timestamp: 2026-09-16T12:26:15Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4, sonnet, found no actionable issues)
**Total findings:** 1 BLOCKER, 3 WARNINGs, several NITs, 0 CONVENTIONs
**Fixed:** BLOCKER + all 3 WARNINGs + 3 NITs | **Deferred:** the rest (see ledger) | **Asked:** 0

This loop earned its length: every pass through iteration 3 caught a real issue. The branch fixes a
cut-blocking stale browser-check (render-head-row, staled by #3128 cog-left).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 0 WARNINGs
**Self-generated:** 0
- [BLOCKER] render-head-row.js:112,155,168 — #3128 moved the gear INTO .pjtitle, so sameLine(.pjtitle, gear) is VACUOUS (descendant always inside ancestor); the original one-line control fix left the wide assertions vacuous --> FIXED: reworked boxes() + all 4 sites to the gear's real sibling #pj-one-name, robust gear/search control, positive stacked guard

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 2 NITs
- [WARNING] render-head-row.js:1 — Browser-check-surface declaration not extended to the new load-bearing ids --> FIXED: added pj-settings-link + pj-one-name (so the #2518 gate catches future id restyles at PR time)
- [NIT] :189 population floor still 9 after adding a 10th assertion --> FIXED: bumped to 10
- [NIT] :119 pre-existing stale "760px" comment --> FIXED: 960px/60rem

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 2 NITs
- [WARNING] render-head-row.js:1 — declaration missed the CONTAINER token pjtitle-row (whose flex rule implements the pin); a container-only restyle would escape the gate --> FIXED: added pjtitle-row (gate supports class tokens, whole-token match, over-fire tolerated)
- [NIT] :132 !sameLine passes on a null search box too --> DEFERRED: inherited pattern not introduced here; search presence is exercised by the 961px arm
- [NIT] plan prose "repointed" vs "added" --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Converged** — no actionable findings.
- [NIT] docs/browser-checks/README.md:368 — one-line description says "beside the title"; the check now measures #pj-one-name (the project title text) --> DEFERRED: not in this diff; #pj-one-name IS the project title at the user level, so the #1043 user-facing description still holds

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | render-head-row.js:112,155,168 | BRANCH | Wide sameLine(.pjtitle,gear) vacuous after #3128 | FIXED | 350544de6 |
| 2 | 2 | WARNING | render-head-row.js:1 | SELF | Surface decl missing the new subject ids | FIXED | d18b24529 |
| 3 | 2 | NIT | render-head-row.js:189 | BRANCH | Population floor 9 vs 10 assertions | FIXED | d18b24529 |
| 4 | 2 | NIT | render-head-row.js:119 | BRANCH | Stale 760px comment | FIXED | d18b24529 |
| 5 | 3 | WARNING | render-head-row.js:1 | SELF | Surface decl missing the pjtitle-row container | FIXED | 2b2457528 |
| 6 | 3 | NIT | render-head-row.js:132 | BRANCH | Null-box false-pass in the control | DEFERRED | Inherited; search presence covered by 961px arm |
| 7 | 3 | NIT | plan:31 | SELF | Prose "repointed" vs "added" | FIXED | 2b2457528 |
| 8 | 4 | NIT | README.md:368 | BRANCH | "beside the title" wording drift | DEFERRED | Not in diff; #pj-one-name is the title at user level |

### Outstanding questions (ASKED)
None.

### Strengths (across iterations)
- The rework fixes the real defect the control-only fix would have masked (vacuous ancestor/descendant sameLine), repointing all sites to the independent sibling #pj-one-name; verified against the real DOM (both ids flex children of .pjtitle-row) and CSS (60rem stacks search, not the gear/name pair)
- The negative control is a genuine inversion of the wide gear/search assertion, provably false at 700px (search stacks); the positive stacked guard tests a previously-unguarded case
- Verified in isolation: 10/10 checks pass on the real #3128 board; the population floor (10) exactly matches the assertion count; surface-map validation passes with the extended token list
- No em dashes in either changed file (all spellings checked)
