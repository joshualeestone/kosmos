---
pre_challenge: true
method: challenge-loop
branch: provtally-6966
diff_hash: b7e3ee8edd3fc21a0c25d5c52bc3a4a6cff20c04a22e2bccb9146e96365325d9
validation: passed
subdir_audit: passed
timestamp: 2026-10-23T05:55:04Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes
**Total findings:** 1 BLOCKER, 17 WARNINGs, 3 CONVENTIONs, 18 NITs new across the rounds, plus repeats
**Fixed:** 15 | **Deferred:** 6 | **Asked (awaiting user):** 0

Final validation (6j) failed once on two tree-wide guards (fixture-discipline: a hand-built stopped card;
no-name-refs-3071: a fixture agent name), recorded as a synthetic finding, fixed (cd62dde18c), and re-run:
passed (23426 tests, 0 failed; shell shard 284 passed). Browser check render-grid-card-width through the harness
passes; GW_CONTROL=1 and GW_CONTROL=6967 each turn their aimed arms red. design-shots projects-grid-6966:
4 shots, 0 overflow.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html:4764 — grid rules shadowed by a later duplicate; project-rows pin governed nothing --> FIXED (55e79bc4a6): edited in place, pin updated
- [WARNING] web/index.html:4222 — unread badge moved on every card --> FIXED (55e79bc4a6), revisited in iteration 4
- [WARNING] web/index.html:4756 — many providers overflow the card --> FIXED (55e79bc4a6), revisited in iteration 3
- [WARNING] tests — nothing checks the tally renders --> FIXED: card-appends test; design-shots screen waits for a visible tally
- [CONVENTION] plan — browser check and shots owed --> FIXED: run and recorded
- [NIT] comments overclaimed (one-colour marks, markless chip) --> FIXED (55e79bc4a6)
- [NIT] mark built per repaint --> FIXED (55e79bc4a6): cached per pick
- [NIT] picks vs PROVIDER_MARK_KEY unchecked --> FIXED: test

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 5 WARNINGs, 2 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html:4233 — comment still said a column --> FIXED (34cfdec792)
- [WARNING] engine/projects.js:1075 — profile read per member per refresh --> DEFERRED: only older codex agents with no job; one small read
- [WARNING] web/index.html:4237 — no faces leaves an empty line --> FIXED (34cfdec792): :empty
- [WARNING] Qwen fixture missing --> DEFERRED: covered by engine/qwen-review2-5977 and accountproblem tests
- [CONVENTION] render-grid-card-width.js — NaN line-height --> FIXED (34cfdec792): one-line probe

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above
- [WARNING] web/index.html:4761 — comment claimed many providers stay beside the count; flex wrapping did not --> FIXED (49d88f6aa9): flex-basis 0, max-width max-content
- [WARNING] render-grid-card-width.js:162 — control not aimed at the two-line arm --> FIXED (49d88f6aa9), then split into two controls
- [NIT] badge baseline group of one --> FIXED (49d88f6aa9): row aligns on baseline

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html:4742 — the badge's own align-self: center overrode the row's baseline --> FIXED (e4bea29772)
- [WARNING] side rail keeps asgrid --> DEFERRED: placeProjectsView removes asgrid on entering the rail (web/index.html:51655)
- [NIT] plan overstated the engine control --> FIXED (e4bea29772)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [BLOCKER] engine/projects.js:1076 — a stopped agent's card has no runner and providerOf named it Claude --> FIXED (695d916e2d): projectview.familyOf, null with no runner; stopped-member test
- [WARNING] two derivations of the family disagree --> FIXED (695d916e2d): the card uses familyOf, as kosmos project show does
- [WARNING] mobile-shots fixture count mismatch --> FIXED (695d916e2d)
- [WARNING] render-grid-card-width picks the first card by position --> FIXED (695d916e2d): by title
- [WARNING] OpenAI mark reads lighter at 13px --> DEFERRED: same artwork and scale as the provider picker; noted on #6966

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 new actionable (4 WARNINGs, each a repeat or not reachable), 1 CONVENTION repeat, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] providerLabel 'Anthropic' for an unknown provider --> DEFERRED: unreachable; every runnerProvider/codexJobProvider value has a label and familyOf maps anthropic to Claude
**Converged** — no new actionable findings.

#### Final validation (6j)
- [BLOCKER] final-validation: fixture-discipline (hand-built card) and no-name-refs-3071 failed --> FIXED (cd62dde18c); re-run passed

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html:4764 | SELF | shadowed duplicate grid rules | FIXED | 55e79bc4a6 |
| 2 | 1 | WARNING | web/index.html:4756 | SELF | tally overflow | FIXED | 55e79bc4a6, 49d88f6aa9 |
| 3 | 2 | WARNING | engine/projects.js:1075 | SELF | profile read per refresh | DEFERRED | bounded, older codex only |
| 4 | 3 | WARNING | web/index.html:4761 | SELF | comment claimed wrap behaviour | FIXED | 49d88f6aa9 |
| 5 | 4 | WARNING | web/index.html:4742 | BRANCH | badge align-self override | FIXED | e4bea29772 |
| 6 | 4 | WARNING | web/index.html:4251 | BRANCH | rail keeps asgrid | DEFERRED | removed at 51655 |
| 7 | 5 | BLOCKER | engine/projects.js:1076 | SELF | stopped agent counted as Claude | FIXED | 695d916e2d |
| 8 | 5 | WARNING | web/index.html:4767 | SELF | OpenAI mark light at 13px | DEFERRED | picker's artwork; on card |
| 9 | 6j | BLOCKER | web.provider-tally-6966.test.js | BRANCH | final-validation guards | FIXED | cd62dde18c |

### NITs (non-blocking, across all iterations)
- Cache keyed by pick holds two entries for Gemini and Google (iteration 3)
- Untied and stopped members can leave the tally short of "N agents" (iterations 5, 6; documented in the plan)
- Control matches assertion text by substring (iteration 4)

### Strengths (across all iterations)
- `provider` is behind the same tied-agent gate as the face, and now null with no runner, so nothing is guessed.
- Member rows in the test come from the real producer, including a real paneless card.
- The grid-card check has a control per "before", each required to turn its own arm red.
- Every rendered word is escaped; screen readers hear one sentence of words, the marks are hidden.
