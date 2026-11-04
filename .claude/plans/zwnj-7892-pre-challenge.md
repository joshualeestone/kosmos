---
pre_challenge: true
method: challenge-loop
branch: zwnj-7892
diff_hash: ab6343d414db2f4ae17ec93791ebb26935ed9a007ee88e90afab358ec276fc7a
validation: local only (engine/seadmin-7116.test.js 20/20 with the real Secure Enclave tests run, engine.reachable.test.js 8/8, on c009e03107); the full suite runs on the PR's CI
subdir_audit: not run (no CLAUDE.md in the diff)
timestamp: 2026-11-04T10:45:00Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped at iteration 8 under Splinter's 8-round rule (past 8 only with a BLOCKER open); round 8 raised no BLOCKER. A rule stop, not a user stop.
**Total actionable findings:** 1 BLOCKER, 14 WARNINGs, 1 CONVENTION (plus NITs)
**Fixed:** 1 BLOCKER, 13 WARNINGs, 1 CONVENTION | **Named as residuals / carried to the card:** 2 WARNINGs | **Asked:** 0

The last suite ran on c009e03107 (the head this proof covers).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
- [BLOCKER] engine/seadmin.js joinerInWord - any joiner between two same-script letters was kept, including ones that change nothing (after an alef, ZWJ between Arabic letters, Indic with no virama) --> FIXED (caed5220b1): IDNA ContextJ
- [WARNING] the header and plan understated the gap --> FIXED with the rule
- [WARNING] no row with two joining scripts either side --> FIXED (caed5220b1)
- [WARNING] header bullet still said every zero-width character is escaped --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
- [WARNING] tatweel and superscript alef inside the accepted ranges --> FIXED (84b8b79df8)
- [WARNING] Tamil has no half forms --> FIXED (84b8b79df8), dropped
- [WARNING] the rows did not exercise the table --> FIXED (84b8b79df8)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 3 NITs
**Self-generated:** 1 (the CONVENTION: the plan still listed Tamil, written by this loop)
- [WARNING] most R groups unpinned --> FIXED (f21f510e1b)
- [CONVENTION] plan contradicted the code --> FIXED (f21f510e1b)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
- [WARNING] only two of nine virama scripts pinned as kept --> FIXED (af81e752bd)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] Sinhala ZWNJ changes nothing; no-half-form letters look alike --> FIXED in part (9e8428291d): Sinhala ZWJ only; the no-half-form case named as a residual

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] the U set unpinned --> FIXED (346546b8ea)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 (the residual's wording, written in iteration 5)
- [WARNING] a ZWJ in Telugu, Kannada, Gurmukhi, Oriya asks for almost nothing --> FIXED (440120f814): per-script joiners
- [WARNING] the Telugu ZWJ row pinned a residual as spelling --> FIXED (440120f814)
- [WARNING] the residual overstated ("ZWJ, ZWNJ or neither") --> FIXED (440120f814)

#### Iteration 8
**Reviewer model:** sonnet (whole branch, nothing pre-cleared)
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0
- [WARNING] a joiner next to an independent vowel or Om is kept --> named as a residual (c009e03107); a per-script consonant table is carried to #7892
- NITs: end-of-word virama joiner and superscript alef skip pinned; the end-of-word guard is redundant (its mutant stays green, stated)
**Stopped** - iteration 8, the cap, no BLOCKER open.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | engine/seadmin.js | BRANCH | invisible joiners kept | FIXED | caed5220b1 |
| 2 | 1 | WARNING | engine/seadmin.js | BRANCH | gap understated | FIXED | caed5220b1 |
| 3 | 1 | WARNING | engine/seadmin-7116.test.js | BRANCH | no two-script row | FIXED | caed5220b1 |
| 4 | 1 | WARNING | engine/seadmin.js | BRANCH | header bullet | FIXED | caed5220b1 |
| 5 | 2 | WARNING | engine/seadmin.js | BRANCH | tatweel, U+0670 | FIXED | 84b8b79df8 |
| 6 | 2 | WARNING | engine/seadmin.js | BRANCH | Tamil | FIXED | 84b8b79df8 |
| 7 | 2 | WARNING | engine/seadmin-7116.test.js | BRANCH | table unexercised | FIXED | 84b8b79df8 |
| 8 | 3 | WARNING | engine/seadmin-7116.test.js | BRANCH | R groups unpinned | FIXED | f21f510e1b |
| 9 | 3 | CONVENTION | .claude/plans/zwnj-7892.md | SELF | plan vs code | FIXED | f21f510e1b |
| 10 | 4 | WARNING | engine/seadmin-7116.test.js | BRANCH | viramas unpinned | FIXED | af81e752bd |
| 11 | 5 | WARNING | engine/seadmin.js | BRANCH | Sinhala ZWNJ, no half form | FIXED in part | 9e8428291d |
| 12 | 6 | WARNING | engine/seadmin-7116.test.js | BRANCH | U set unpinned | FIXED | 346546b8ea |
| 13 | 7 | WARNING | engine/seadmin.js | BRANCH | ZWJ in four scripts | FIXED | 440120f814 |
| 14 | 7 | WARNING | engine/seadmin-7116.test.js | BRANCH | Telugu row | FIXED | 440120f814 |
| 15 | 7 | WARNING | engine/seadmin.js | SELF | residual overstated | FIXED | 440120f814 |
| 16 | 8 | WARNING | engine/seadmin.js | BRANCH | non-consonant neighbour | NAMED | c009e03107; card |

### Outstanding questions
None.

### NITs (non-blocking, across all iterations)
- Arabic range edges U+06FF and U+077F unpinned (ranges fail toward marking) (iteration 6)
- other Joining_Type T marks not skipped (conservative) (iteration 3)

### Strengths (across all iterations)
- Follows IDNA ContextJ and fails closed: anything outside the narrow ranges and the per-script table is escaped and marked
- The Arabic Joining_Type table was checked against ArabicShaping.txt by four reviewers with no wrong entry found
- Every table group, script and joiner has a row that fails if it is wrong; NFC controls on the half-form rows
- No raw invisible character in any changed file, checked by bytes after every edit
