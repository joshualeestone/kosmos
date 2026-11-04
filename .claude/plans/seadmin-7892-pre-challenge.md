---
pre_challenge: true
method: challenge-loop
branch: seadmin-7892
diff_hash: 552fd946c786c229c9b1bc1d9dfbddc842a83ea031e231e487df62dcdfd4d4ae
validation: local only (engine/seadmin-7116.test.js 19/19 with the real Secure Enclave tests run, engine.reachable.test.js 8/8, both on 054d84404e); the full suite runs on the PR's CI
subdir_audit: not run (no CLAUDE.md in the diff)
timestamp: 2026-11-04T05:21:24Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped at iteration 8 under Splinter's 8-round rule (2026-10-22: past 8 only with a BLOCKER open); round 8 raised no BLOCKER. This is a rule stop, not a user stop.
**Total actionable findings:** 1 BLOCKER, 16 WARNINGs, 2 CONVENTIONs (plus NITs below)
**Fixed:** 1 BLOCKER, 13 WARNINGs, 2 CONVENTIONs | **Deferred / carried to the card:** 3 WARNINGs | **Asked:** 0

The last suite ran on 054d84404e (the head this proof covers).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 2 WARNINGs, 1 CONVENTION, 5 NITs
**Self-generated:** 1 (the CONVENTION: a doc-comment line an earlier commit on this branch broke)
- [BLOCKER] engine/seadmin.js - default-ignorable marks and letters (U+FE0F, U+034F, U+3164) shown raw --> FIXED (20360806c5)
- [WARNING] engine/seadmin.js - NFC vs NFD look the same --> FIXED (20360806c5)
- [WARNING] engine/seadmin.js - one-script look-alikes (all-Cyrillic) pass --> DEFERRED: not fixable by escaping; stated in the doc comment so `unusual: false` is never read as "cannot be a look-alike"
- [CONVENTION] engine/seadmin.js:34 - broken doc-comment line --> FIXED (20360806c5)
- NITs: EACCES sentence, regexes compiled once, Latin with Han pinned --> FIXED; maxBuffer wording --> comment corrected after measuring

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0
- [WARNING] blank-looking characters U+2800, U+FFFC, U+FFFD --> FIXED (05657d10fe)
- [WARNING] fullwidth compatibility look-alikes --> FIXED (05657d10fe)
- [WARNING] stacked combining marks --> FIXED (05657d10fe)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 0
- [WARNING] leading, trailing and doubled spaces --> FIXED (8ec563596f)
- [WARNING] Common-script letters made ordinary names read mixed --> FIXED (8ec563596f)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1 (the comment's pointed-Hebrew claim, written by iteration 3's fix: deleted, not reworded)
- [WARNING] refusal list claimed every <why>; usage is a variable --> FIXED (65584431cb), test fails on a non-literal fail()
- [WARNING] comment claimed pointed Hebrew is marked; measured false --> FIXED by deleting the claim (65584431cb)
- [WARNING] prompt reason set after the key was bound --> FIXED (65584431cb)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 0
- [WARNING] overlay, enclosing and baseless marks --> FIXED (36df231962)
- [WARNING] two signs in flight, two prompts up --> FIXED (36df231962), sign queue

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] cancel prompt named only admins --> FIXED (df804b60ba)
- [WARNING] more overlay marks (U+20D2 and kin) --> FIXED (df804b60ba)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 (the round-2 pin that Latin with Han is marked: reversed by decision)
- [WARNING] digits from another script did not count --> FIXED (e4c4ada5b3)
- [WARNING] the flag fired on ordinary names (trademark, (kabu), NTT data) --> FIXED in part (e4c4ada5b3): NFKC on letters and digits only, Latin with CJK not mixed. Carried: ZWNJ/ZWJ in Persian and Indic words (named in the comment)

#### Iteration 8
**Reviewer model:** sonnet (whole branch, nothing pre-cleared)
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 0
- [WARNING] native-se/main.swift - the prompt text is unmeasured --> DEFERRED to gate 6 (needs a presence key and a person; parked needs-operator on #7892)
- [WARNING] engine/seadmin.js - more ordinary names carry `unusual` than stated --> FIXED (054d84404e), comment lists them
- [CONVENTION] long comment lines --> FIXED (054d84404e)
**Stopped** - iteration 8, the cap, no BLOCKER open.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | engine/seadmin.js | BRANCH | default-ignorable chars raw | FIXED | 20360806c5 |
| 2 | 1 | WARNING | engine/seadmin.js | BRANCH | NFC/NFD | FIXED | 20360806c5 |
| 3 | 1 | WARNING | engine/seadmin.js | BRANCH | one-script look-alikes | DEFERRED | stated limit |
| 4 | 1 | CONVENTION | engine/seadmin.js:34 | SELF | broken doc line | FIXED | 20360806c5 |
| 5 | 2 | WARNING | engine/seadmin.js | BRANCH | blank-looking chars | FIXED | 05657d10fe |
| 6 | 2 | WARNING | engine/seadmin.js | BRANCH | fullwidth | FIXED | 05657d10fe |
| 7 | 2 | WARNING | engine/seadmin.js | BRANCH | mark stacks | FIXED | 05657d10fe |
| 8 | 3 | WARNING | engine/seadmin.js | BRANCH | invisible spaces | FIXED | 8ec563596f |
| 9 | 3 | WARNING | engine/seadmin.js | BRANCH | Common letters | FIXED | 8ec563596f |
| 10 | 4 | WARNING | engine/seadmin.js | BRANCH | usage not a literal | FIXED | 65584431cb |
| 11 | 4 | WARNING | engine/seadmin.js | SELF | Hebrew claim false | FIXED | 65584431cb (deleted) |
| 12 | 4 | WARNING | native-se/main.swift | BRANCH | reason after bind | FIXED | 65584431cb |
| 13 | 5 | WARNING | engine/seadmin.js | BRANCH | overlay/baseless marks | FIXED | 36df231962 |
| 14 | 5 | WARNING | engine/seadmin.js | BRANCH | concurrent signs | FIXED | 36df231962 |
| 15 | 6 | WARNING | native-se/main.swift | BRANCH | cancel prompt | FIXED | df804b60ba |
| 16 | 6 | WARNING | engine/seadmin.js | BRANCH | more overlays | FIXED | df804b60ba |
| 17 | 7 | WARNING | engine/seadmin.js | BRANCH | foreign digits | FIXED | e4c4ada5b3 |
| 18 | 7 | WARNING | engine/seadmin.js | SELF | false flags on ordinary names | FIXED in part | e4c4ada5b3; ZWNJ carried |
| 19 | 8 | WARNING | native-se/main.swift | BRANCH | prompt unmeasured | DEFERRED | gate 6 |
| 20 | 8 | WARNING | engine/seadmin.js | BRANCH | false positives understated | FIXED | 054d84404e |
| 21 | 8 | CONVENTION | engine/seadmin.js | SELF | long lines | FIXED | 054d84404e |

### Outstanding questions
None.

### NITs (non-blocking, across all iterations)
- ENOENT reads "not installed" when only the loader is missing (iterations 5, 7) - carried to the card
- the `args` regex in the reason test is a weak extra check (iteration 6)
- plan numbering (iterations 2, 4, 8)

### Strengths (across all iterations)
- Helper failures reach a caller only as fixed sentences, held to main.swift both ways (iterations 3 to 8)
- The prompt reason comes from the signed tag, set before the key is loaded (iterations 4 to 8)
- The sign queue: one signature at a time, a failure never stalls it (iterations 5 to 8)
- Tests carry controls that can return the dangerous answer (NFC-stable stacks, composed forms, ASCII digits, one space)
- Every fix has a mutant that turns the suite red, run by the author
