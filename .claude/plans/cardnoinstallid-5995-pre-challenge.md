---
pre_challenge: true
method: challenge-loop
branch: cardnoinstallid-5995
diff_hash: e993136ec39ccb40ff20a459c68957279ea2145560faa274cae117b738443987
validation: partial, stated as what ran (the repo's full validation ran at ef049382e, finishing 2026-10-12 21:49 CDT: 19664 tests, 19428 passed, 1 FAILED, 235 skipped. The one failure was this change: engine/store.fsync-5434.test.js took a save's answer for the bytes on disk. That test was rewritten at 261f916b4 and is red by name when a save answers with the whole record. Since then main 4dfbcaad1 was merged in and reviews 5 and 6 changed comments and one test title. At the final code f678fbe1a's tree merged with main: this branch's tests and every test file the plan names 617 passed, the source-sweep guards 180 passed, every web*.test.js 2752 passed; after review 5's edits the five touched test files 41 passed. The full suite has NOT run since the fix: PR CI is that run)
subdir_audit: passed
timestamp: 2026-10-13T03:46:15Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6 (default, sonnet, default, sonnet, default, sonnet)
**Converged:** Yes: iteration 6 found no blocker, no warning and no convention finding (3 NITs, none applied).
**Total new findings above NIT:** 0 BLOCKERs, 2 WARNINGs, 3 CONVENTIONs (counted from the lines below)
**Fixed:** 2 WARNINGs, 3 CONVENTIONs | **Not taken:** 0 | **Asked (awaiting user):** 0

The full text of each finding and its answer is in `.claude/plans/cardnoinstallid-5995.md`, "Review 1" to "Review 6".

**Three things a reader must not miss:**
- The design changed after iteration 3. Iterations 1 to 3 each found another place that served the whole profile
  (the card, the save answer, a stopped agent's row), so the rule moved into the store: a profile leaves
  `engine/store.js` without the install's id. Convergence counts from that design: iterations 4, 5 and 6.
- Iteration 4 was clean, and the full suite then found a red no reviewer and no search had: a test that never names
  the field. The plan's weakest premise said that kind of caller would not be found by the search. One was.
- Between iterations 4 and 5, main was merged in (item 3 of the same card, kosmos#6018, had landed first) and this
  branch corrected item 3's test and two of its sentences, as its plan said the second to merge must.

**Self-generated** below is my reading of each round against the commits before it, not a blame lookup per finding.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** default
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs
**Self-generated:** 0
- [WARNING] the answer to a profile save carried the install's id --> FIXED (eb7a8b4c5)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs
**Self-generated:** 0
- NITs only, taken (7dbd8f140). This round recorded "no other path", which iteration 3 showed to be wrong.

#### Iteration 3
**Reviewer model:** default
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION
**Self-generated:** 1
- [WARNING] a stopped agent's row, built in `server.js`, still served the whole profile --> FIXED by moving the rule into the store (ef049382e)
- [CONVENTION] a text check on three source lines claimed more than it held --> FIXED by removing it; the tests assert on what is answered (ef049382e)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs
**Self-generated:** 0
- NITs only, not applied.

#### Iteration 5
**Reviewer model:** default
**New findings:** 0 BLOCKERs, 0 WARNINGs, 2 CONVENTIONs
**Self-generated:** 2
- [CONVENTION] a test titled "only engine/store.js reads the record whole" was not true of the tree --> FIXED: retitled to what it holds, and its comment names the files that parse a profile file themselves (f678fbe1a)
- [CONVENTION] commit subjects use a colon, not the repo's `<branch> -- <message>` --> FIXED where it lands: the squash title uses that form

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs
**Self-generated:** 0
- NITs only, not applied (the plan says why for each).

### What this does not prove
- The profile save route was never driven over HTTP. What it answers with is `writeProfile`'s answer, which is held.
- Five other files parse a profile file themselves. Each was read and none hands the record on; no test would see one
  start to.
- Nothing here has been seen in a browser. The page does not read the field: that is a search, not a look.
- Mutants were run at ef049382e and for the rewritten fsync test at 261f916b4, not again at the final head. The code
  they aim at has not changed since.
