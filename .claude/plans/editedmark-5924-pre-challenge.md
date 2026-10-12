---
pre_challenge: true
method: challenge-loop
branch: editedmark-5924
diff_hash: d84dc2211c913b694233d6ee890a7a84f16afedae4c4530193b95e0af44a7844
validation: passed
subdir_audit: passed
timestamp: 2026-10-12T12:53:24Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes
**Total findings:** 12 (0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, 7 NITs)
**Fixed:** 4 | **Deferred:** 1 | **Asked (awaiting user):** 0

Validation: the full suite on head 47b503572 (19,522 tests, 0 fail, 235 skipped; hash d84dc2211c91),
then the 6j gate skipped on that clean entry. Two earlier validation runs were stopped while still
queued (no tests had run) because review fixes were about to change the tree.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above (ITER_COMMITS empty)
- [WARNING] engine/communityread.test.js — the --replies digest's [r] and [p] render sites had no test --> FIXED (4e12bebb1): new readReplies test, proved red with both markers removed
- [WARNING] engine/communityfollow.js:135 — asPost drops edited_at, so --following never shows it --> FIXED (4e12bebb1), later REVERSED at iteration 3 (see ledger #5)
- [NIT] engine/communityread.test.js — malformed-value case never exercised the 10-character slice --> taken: forged-tail case added (4e12bebb1)
- [NIT] engine/communityread.js:171 — say the slice, not the regex, is the safety property --> taken at iteration 3 (47b503572)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/communityread.js:171 — editedOf accepts impossible dates (9999-99-99T) --> DEFERRED: see ledger #3
- [NIT] engine/communityread.js:171 — date sliced without timezone normalisation (consistent with `at`)
- [NIT] .claude/plans/editedmark-5924.md — "Done when" could be read to include --following

#### Iteration 3
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above (communityfollow.js:147, the iteration-1 passthrough)
- [WARNING] engine/communityfollow.js:147 — the community's FollowingItem has no edited_at (verified: kosmos-community app/schemas.py:393, origin/main), so the passthrough can never fire and its test passed only on an invented field --> FIXED (47b503572): passthrough and test removed (code returned to origin/main), Following feed split to #5925
- [WARNING] .claude/plans/editedmark-5924.md:6-8 — "Done when" names the feed without qualification --> FIXED (47b503572): narrowed, Out of scope section added
- [NIT] engine/communityread.js:171 — shape check, not date check
- [NIT] engine/communityread.test.js:1699 — head() regex relies on unindented comment lines

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs (all repeats of NITs above or of the documented scope)
**Self-generated:** 0 of the above
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/communityread.test.js | BRANCH | --replies [r]/[p] markers untested | FIXED | 4e12bebb1 |
| 2 | 1 | WARNING | engine/communityfollow.js:135 | BRANCH | asPost drops edited_at | FIXED then superseded | 4e12bebb1, reverted in 47b503572 per #5 |
| 3 | 2 | WARNING | engine/communityread.js:171 | BRANCH | impossible dates accepted | DEFERRED | The service sends an aware datetime (schemas.py edited_at: datetime), so no impossible date can come from it; `at` beside it is checked the same way; only digits and hyphens reach the header, so no forgery path. By design per plan ("same shape as `at`"). |
| 4 | 3 | WARNING | .claude/plans/editedmark-5924.md:6-8 | BRANCH | done-when wider than the code | FIXED | 47b503572 |
| 5 | 3 | WARNING | engine/communityfollow.js:147 | SELF | passthrough inert; test on invented field | FIXED | 47b503572 (deleted, not rewritten; #5925) |

### Outstanding questions (ASKED, still unresolved when the run ended)
- none

### NITs (non-blocking, across all iterations)
- [NIT] engine/communityread.test.js — forged-tail case (iteration 1, taken)
- [NIT] engine/communityread.js:171 — comment should name the slice (iteration 1, taken in iteration 3)
- [NIT] engine/communityread.js:171 — no timezone normalisation, consistent with `at` (iteration 2)
- [NIT] .claude/plans/editedmark-5924.md — done-when vs --following (iteration 2, became WARNING #4)
- [NIT] engine/communityread.js:171 — shape check, not date check (iterations 3 and 4)
- [NIT] engine/communityread.test.js:1699 — head() filter relies on unindented lines (iteration 3)
- [NIT] engine/communityread.js:228 — UTC date may differ from local date, as `at` does (iteration 4)

### Strengths (across all iterations)
- The header sits outside the quoting and editedOf keeps only 10 characters of digits and hyphens, so a hostile edited_at cannot forge a "(post <id>)" or "(comment <id>)"; tested both ways (iterations 1-4)
- Tombstones gated on the board as well as the service, with its own assertion (iterations 3, 4)
- One editedNote helper serves all four render sites; the reduced-keys leak test was updated deliberately (iterations 1, 3)
- Every positive assertion has an unedited control; fixtures match the real service shapes (iteration 4)
