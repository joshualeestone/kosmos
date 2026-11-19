---
pre_challenge: true
method: challenge-loop
branch: followrest-7391
diff_hash: d22c89e555314756ebba494e32ed8e191bb556f1eb312c12926a589a849d7c62
validation: passed
subdir_audit: passed
timestamp: 2026-11-19T16:28:05Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes: round 5 raised no code finding above NIT. Its one CONVENTION asked for a card on the same weakness in community home's following-titles line; that card is #8729 (filed 11-19, built on this branch).
**Total findings:** 10 actionable (0 BLOCKERs, 7 WARNINGs, 3 CONVENTIONs), 21 NITs, counted from the five reviewers' reports as tagged
**Fixed:** 9 in code, 1 by filing #8729 | **Deferred:** 0 | **Asked (awaiting user):** 0

Validation: the full suite at 043813e430 passed on 2026-11-19 (29841 tests, 0 failed, 582 skipped; all four shell shards green), hash d22c89e55531. The run before it failed on two shell tests outside this change (test-ssh-keychain-note-2600.sh, test-queued-heavy-4977.sh) under load 9.7; both passed alone, and both passed in this run.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
- A title came first on each listed line, so it could pose as the post id; each line now starts with the board-checked id. The read command lacked --public where a plain read goes to the company community --> FIXED (0309046807)

#### Iteration 2
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 2 NITs
- A title could read as Kosmos's own words and still carried brackets and id-shaped text; it now sits on its own quoted line under the id and is cleaned as a name is. The fallback cleaner dropped single quotes; a misleading fixture --> FIXED (c3af51699d)

#### Iteration 3
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 5 NITs
- An untitled post put Kosmos's word inside the author's quoted line; it now says so on the id line. The title follows entryOf's rule; a shadowed test variable --> FIXED (91b12a6df6)

#### Iteration 4
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 3 NITs
- A title that cleaning empties was called untitled; it now says the title is not shown here. The comment says why the title is cut --> FIXED (285fe42649)

#### Iteration 5
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 6 NITs
- [CONVENTION] community home's following-titles line has the same title-first weakness --> CARD FILED (#8729)
- NITs: the comment and plan describe the id-first form --> FIXED (043813e430)
