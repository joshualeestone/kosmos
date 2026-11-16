---
pre_challenge: true
method: challenge-loop
branch: unmatched-8566
diff_hash: 142f875b619c111aaaca731013b8e541ff316d28b0a9aa2ffa754fcbf745e3dc
validation: passed
subdir_audit: passed
timestamp: 2026-11-16T00:18:34Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped by the standing review-usage rule (Splinter 2026-10-22, restated 10-26: a loop stops at 8 rounds unless a BLOCKER is open; the last round is a whole-branch read with no plan file). Rounds 3 to 8 were whole-branch reads with no plan file. Round 8 had no BLOCKER; its WARNING and NITs went to follow-up card kosmos#8569.
**Total findings:** 17 actionable (1 BLOCKER, 13 WARNINGs, 3 CONVENTIONs), plus NITs
**Fixed:** 14 | **Deferred:** 3 (1 to #8569, 2 judged the card's intent) | **Asked (awaiting user):** 0

Every round's fixes were mutation-tested: each changed site was broken in turn and a test went red, or the check was removed as dead. Full validation passed (29237 tests, 0 fail, hash 142f875b619c).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (default)
**New findings:** 1 BLOCKER, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
- [BLOCKER] engine/messages.js unmatchedNote — a multi-word member name written differently (Sub Zero, Renet Tilley) woke the member and the note still said it woke no one: I had removed the targetResolves skip as redundant --> FIXED (0ff50e6d7c)
- [WARNING] a cut after cleaning could leave a lone surrogate --> FIXED (0ff50e6d7c)
- [WARNING] a test assertion that could not fail --> FIXED (0ff50e6d7c)
- [NIT] note beside @all --> FIXED (0ff50e6d7c)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above
- [WARNING] a topic after a comma (Kitty, heads-up on #12) drew the sentence on a post that worked --> FIXED (3360f0de1f), then narrowed in iteration 5
- [WARNING] the @all silence also hid a typo beside a full list --> FIXED (3360f0de1f), then superseded in iteration 5

#### Iteration 3 (whole branch, no plan file)
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 1 of the above
- [WARNING] common comma topics (heads up, FYI) still drew it --> FIXED (77f288fbbb), then narrowed in iteration 5
- [WARNING] word-form sentences (Leo for the record:) drew it --> FIXED (77f288fbbb); word form dropped in iteration 5

#### Iteration 4 (whole branch, no plan file)
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 2 NITs
**Self-generated:** 1 of the above
- [WARNING] title-case group words (Team, Both) drew it --> FIXED (935fe2af5d), then superseded in iteration 5
- [CONVENTION] a comment claimed O'Brien passes --> FIXED (935fe2af5d)

#### Iteration 5 (whole branch, no plan file)
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] short names for run-together members (Kitty, Mona) called not a member's --> FIXED (9c5ab14210)
- [WARNING] the deny list could never end --> FIXED by narrowing (9c5ab14210): only a post that woke no member, only the poster's own arrow header

#### Iteration 6 (whole branch, no plan file)
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] a reply wakes the author it answers, so "woke no one" could sit beside a wake --> FIXED, replies skipped (86a8b1c300)
- [WARNING] noise on posts addressed to the person --> DEFERRED: the card asks for exactly this sentence
- [NIT] all/everyone in a room of the poster alone --> FIXED (86a8b1c300), then superseded in iteration 7

#### Iteration 7 (whole branch, no plan file)
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 5 NITs
**Self-generated:** 1 of the above
- [WARNING] a room of the poster alone: the CLI says everyone has it beside the sentence --> FIXED (dca21096c1)
- [CONVENTION] the reply comment claimed more than the rule --> FIXED (dca21096c1)
- [NIT] a member display name cut after cleaning; lower-case sentence start --> FIXED (dca21096c1)
- [NIT] a Latin spelling of a non-Latin display name gets the sentence --> DEFERRED: true, and the member list beside it shows the member

#### Iteration 8 (whole branch, no plan file)
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] every other member switched off: the CLI's empty-outcomes verdict contradicts the sentence (reasoned) --> DEFERRED to kosmos#8569
- [NIT] outsider rule re-derived, case-sensitive de-duplication, possessive printed as written --> DEFERRED to kosmos#8569

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | engine/messages.js unmatchedNote | SELF | woken member called no member's | FIXED | 0ff50e6d7c |
| 2 | 1 | WARNING | engine/messages.js unmatchedNote | SELF | lone surrogate | FIXED | 0ff50e6d7c |
| 3 | 1 | WARNING | engine/messages.unmatched-8566.test.js | SELF | assertion could not fail | FIXED | 0ff50e6d7c |
| 4 | 2 | WARNING | engine/messages.js unmatchedNote | SELF | comma topic | FIXED | 3360f0de1f, 9c5ab14210 |
| 5 | 2 | WARNING | engine/messages.js call site | SELF | @all silence too broad | FIXED | 3360f0de1f, 9c5ab14210 |
| 6 | 3 | WARNING | engine/messages.js unmatchedNote | SELF | comma topics | FIXED | 77f288fbbb, 9c5ab14210 |
| 7 | 3 | WARNING | engine/messages.js unmatchedNote | BRANCH | word-form sentences | FIXED | 9c5ab14210 |
| 8 | 4 | WARNING | engine/messages.js unmatchedNote | SELF | title-case group words | FIXED | 9c5ab14210 |
| 9 | 4 | CONVENTION | engine/messages.js | SELF | O'Brien comment | FIXED | 935fe2af5d |
| 10 | 5 | WARNING | engine/messages.js unmatchedNote | SELF | run-together member names | FIXED | 9c5ab14210 |
| 11 | 5 | WARNING | engine/messages.js unmatchedNote | SELF | endless deny list | FIXED | 9c5ab14210 |
| 12 | 6 | WARNING | engine/messages.js call site | SELF | reply wakes its author | FIXED | 86a8b1c300 |
| 13 | 6 | WARNING | engine/messages.js | BRANCH | notes on posts to the person | DEFERRED | the card's intent |
| 14 | 7 | WARNING | engine/messages.js call site | SELF | poster-alone room | FIXED | dca21096c1 |
| 15 | 7 | CONVENTION | engine/messages.js | SELF | reply comment | FIXED | dca21096c1 |
| 16 | 8 | WARNING | engine/messages.js call site | BRANCH | switched-off members, CLI verdict | DEFERRED | #8569 |
| 17 | 8 | CONVENTION | engine/messages.js | SELF | outsider rule re-derived | DEFERRED | #8569 |

### Outstanding questions (ASKED, still unresolved when the run ended)
- none

### NITs (non-blocking, across all iterations)
- Word-to-text duplication is avoided: one sentence, read by both CLIs as-is (iteration 1)
- The member list repeats on every such post (iteration 6)
- Case-sensitive de-duplication of names (iteration 8)

### Strengths (across all iterations)
- Every clause of the sentence is true whoever the name meant; it never says "did not reach them" (all iterations)
- The guard is a superset of every route an agent's post wakes a member by (iterations 7, 8)
- Each silent case has a control that makes the same condition speak (iterations 5 to 8)
