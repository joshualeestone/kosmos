---
pre_challenge: true
method: challenge-loop
branch: failtell-5400
diff_hash: 890f133c31c6304e3ad09cc31fe2d43de0e434bcba10b07e3b6457284114a211
validation: passed (Mortals full suite at feff33cbc, hash 890f133c31c6)
subdir_audit: passed
timestamp: 2026-10-07T18:23:14Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10 blind reviews, alternating Opus and Sonnet.
**Converged:** Yes, at iteration 10, which raised no BLOCKER and no WARNING.
**Total findings:** 2 BLOCKERs and 8 WARNINGs, plus NITs.
**Fixed:** 10 | **Deferred:** 0 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

- [BLOCKER] Iteration 1: the note went in front of /clear and /compact. FIXED: a line starting with "/" or "!" gets no note.
- [WARNING] Iteration 1: "told" was recorded on an UNCONFIRMED delivery. FIXED: told only on PLACED.
- [BLOCKER] Iteration 2: a menu digit got the note. FIXED: a single short token gets no note.
- [WARNING] Iteration 3: the restart-for-handoff request got the note. FIXED: { movedNote: false }, pinned in source.
- [WARNING] Iteration 4: leading-space commands, the 12-character bound and "!" shell mode were unpinned. FIXED and pinned.
- [WARNING] Iteration 5: the limit menu itself (a capped card) and the server wiring were unpinned. FIXED and pinned.
- [WARNING] Iteration 6: needs_you was unpinned. Pinned.
- [WARNING] Iteration 7: a short real sentence and owed's wiring were unpinned; a mis-cased caller skipped the note. FIXED.
- [WARNING] Iteration 8: the hook-failure guards were unpinned. Pinned.
- [WARNING] Iteration 9: the promise path (production's async lines) was untested. Pinned.
- Iteration 10: converged.

Every rule is mutation-checked: removing it turns a test red in engine/chat.movedtell-5400.test.js.

### After convergence (disclosed)

- 47dada924 fixed a composition defect found when this branch was rebased onto #5382. #5382's own post-merge review made owedFor name the agent now holding a part by its card name, given the roster. This hook called owedFor without the roster, so its note still named agents by session key. It now passes a roster cached with the records. The review 7 source pin requires it, and that pin was red on the old call. This fix was not re-reviewed.
- #5382 merged as PR #5478. This branch's 12 commits were then rebased onto main without conflicts. Its 45 tests and 2085 neighbouring tests pass, and the full suite passed at feff33cbc.
- No web/ file changes, so no browser check applies.
