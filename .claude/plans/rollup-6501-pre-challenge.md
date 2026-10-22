---
pre_challenge: true
method: challenge-loop
branch: rollup-6501
diff_hash: 22be26ef14686e6cb5c63e887b7a235266c8416a333836c243a6f2f4ac838f6e
validation: passed with one stated step. tools/run-tests.sh on 27bb4c7e0e ran 23328 tests with 2 failures, both from this branch (the #6022 teardown guard and the surface gate); fixed in 8bc0666a1d, which changes only docs/browser-checks/render-subtasks-3861.js and adds per-check trailers. On 8bc0666a1d those two test files pass 26/26, the surface gate exits 0, the five surface-mapped checks and render-subtasks-3861.js pass, and the tree is clean. The full suite was not re-run on 8bc0666a1d; CI runs it on the PR.
subdir_audit: passed (no subdirectory CLAUDE.md in the diff)
timestamp: 2026-10-22T20:23:45Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No, stopped at the 8-round cap. Splinter, 10-22 11:08 CDT: "Cap challenge/review loops at 8 rounds. Past 8, continue ONLY while a BLOCKER is open; nits and warnings get filed as a follow-up card and the PR ships." Round 8 raised no BLOCKER; its two WARNINGs are filed as #6928.
**Total findings:** 0 BLOCKERs, 15 WARNINGs, 2 CONVENTIONs, NITs in every round
**Fixed:** 11 WARNINGs, 1 CONVENTION | **Deferred:** 2 WARNINGs | **Filed (#6928):** 2 WARNINGs | **Asked:** 0

Design review (Mona Lisa, comment 6349055216): approved with one copy change, applied in 5d6faa1298. Shots in ~/work/design-shots/kosmos-6501/ (re-shot on 5d6faa1298).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, NITs
**Self-generated:** 0
- [WARNING] web/index.html - the press re-enabled before the reload, so a second press re-posted every close --> FIXED (c33f3266ce; order pinned in web.subtasks-3861.test.js)
- [WARNING] web/index.html - closing could drop a person's repeat rule on a built subtask --> DEFERRED: the engine never lets the two meet (setBuilt refuses a repeating task; setRepeat drops built)
- [CONVENTION] plan file present and matching --> no action

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 1 WARNING, NITs
**Self-generated:** 1
- [WARNING] render-subtasks-3861.js - no browser arm for a double press or a request with no answer --> FIXED (4b285b6f44; mutant without the disabled flag asked [3,3,1,1]: red)

#### Iteration 3
**Reviewer model:** opus (default)
**New findings:** 1 WARNING, 1 CONVENTION, NITs
**Self-generated:** 1
- [WARNING] plan - claimed no bulk close route exists; POST /api/tasks/close does --> FIXED (f410899009: the real reason, it carries on past a refusal)
- [CONVENTION] mobile-shots.js - a copied cleanup helper --> FIXED (throwawayProjectGone)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 1 WARNING, NITs
**Self-generated:** 1
- [WARNING] web/index.html - a press that outlives its page wrote its message and focus on another task --> FIXED (8f6f4ec461: here() checks PJ_CURRENT and TK_OPEN; arm and mutant red)

#### Iteration 5
**Reviewer model:** opus (default)
**New findings:** 3 WARNINGs, 1 CONVENTION, NITs
**Self-generated:** 4
- [WARNING] web/index.html - focus went to tk-done, which reads Reopen on a closed task --> FIXED (5b0288bae6: tk-back)
- [WARNING] render-subtasks-3861.js - the leave-the-page arm read after a fixed wait --> FIXED (waits for the response and the press)
- [WARNING] render-subtasks-3861.js - a swallowed wait before the request count --> FIXED
- [CONVENTION] plan - stale Tests section --> FIXED (rewritten)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 1 WARNING, NITs
**Self-generated:** 1
- [WARNING] render-subtasks-3861.js - a comment still said focus goes to Mark as done --> FIXED (9363db3c92: the claim deleted)

#### Iteration 7
**Reviewer model:** opus (default)
**New findings:** 1 WARNING, NITs
**Self-generated:** 1
- [WARNING] web/index.html - the "reload worked" guard could not see a failed read (loadProjects catches its own failures) --> FIXED (77100ea8ce: PJ_READ_FAILED)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs, NITs
**Self-generated:** 0
- [WARNING] web/index.html - a refusal while the person is on another task is shown nowhere --> FILED #6928 (by design here; the list repaints)
- [WARNING] web/index.html - the failed-reload branch has no browser arm --> FILED #6928
**Stopped at the cap** (no BLOCKER open).

After the loop, the full suite found two reds this branch caused (the #6022 guard and the surface gate) --> FIXED (8bc0666a1d), as recorded in `validation` above.

### Final Ledger

| # | Iter | Category | Origin | Description | Status | Resolution |
|---|------|----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | BRANCH | re-enabled before the reload | FIXED | c33f3266ce |
| 2 | 1 | WARNING | BRANCH | repeat rule dropped on a built subtask | DEFERRED | engine excludes it |
| 3 | 2 | WARNING | SELF | no double-press or aborted arm | FIXED | 4b285b6f44 |
| 4 | 3 | WARNING | SELF | plan's false bulk-route claim | FIXED | f410899009 |
| 5 | 3 | CONVENTION | SELF | copied cleanup helper | FIXED | f410899009 |
| 6 | 4 | WARNING | SELF | press outlives its page | FIXED | 8f6f4ec461 |
| 7 | 5 | WARNING | SELF | focus on Reopen | FIXED | 5b0288bae6 |
| 8 | 5 | WARNING | SELF | arm read after a fixed wait | FIXED | 5b0288bae6 |
| 9 | 5 | WARNING | SELF | swallowed wait before the count | FIXED | 5b0288bae6 |
| 10 | 5 | CONVENTION | SELF | stale Tests section | FIXED | 5b0288bae6 |
| 11 | 6 | WARNING | SELF | stale focus comment | FIXED | 9363db3c92 |
| 12 | 7 | WARNING | SELF | reload guard could not see a failed read | FIXED | 77100ea8ce |
| 13 | 8 | WARNING | SELF | refusal on a page the person left shown nowhere | FILED | #6928 |
| 14 | 8 | WARNING | SELF | failed-reload branch untested | FILED | #6928 |
| 15 | suite | WARNING | SELF | #6022 guard: route answer outside a try | FIXED | 8bc0666a1d |

### NITs (non-blocking, across all iterations)
Recorded per round in .claude/plans/rollup-6501.md; the round 8 set is in #6928.

### Strengths
- One press, the one close route, stopping at the first refusal with the parent open; a stale world repaints rather than acts
- Every behaviour has a browser arm that was mutated red: refusal, aborted request, double press, leaving the page
