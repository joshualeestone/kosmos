---
pre_challenge: true
method: challenge-loop
branch: maskgaps-3995
diff_hash: b1e3b13161158ed58eac5fbaa3e23c5d40cfb664d883f9b4679e99821be37f21
validation: passed
subdir_audit: passed
timestamp: 2026-09-27T00:02:27Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (round 4 returned only a finding already deferred in the plan, and a NIT on pre-existing code)
**Total findings:** 3 BLOCKERs, 7 WARNINGs, 1 CONVENTION, 7 NITs
**Fixed:** 9 | **Deferred:** 4 (named below) | **Asked (awaiting user):** 0

The "Self-generated" field is not recorded for any round: the blame lookup 6c-bis describes was not run in this
loop, so every Origin below is BRANCH, the fail-safe value. Validation: two earlier full runs each failed on one
test in a file this branch does not touch, each green alone (engine/openaiaccounts.devicecode-3436, #4028, fixed on
main and taken in by merge 25dbfd4a; engine/updating-988, #3812). The third run passed on this diff.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 2 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 1 NIT
**Self-generated:** not recorded
- [BLOCKER] engine/secretmask.js: per-gap reach crept on one-character matches ("a" after sk-ant-), so a guide naming the prefix was withheld --> FIXED (7bdd7459: reach moves only on a real piece that takes the walk further)
- [BLOCKER] engine/secretmask.js: the same creep masked a bare mention of the public prefix --> FIXED (7bdd7459)
- [WARNING] engine/secretmask.js: the unpunctuated copy masked a whole JSON object, CSV row or URL glued to the key --> FIXED (7bdd7459: only the text's own key runs holding a matching slice)
- [WARNING] engine/secretmask.test.js: three cases passed on main through a "Key:" label --> FIXED (7bdd7459)
- [WARNING] engine/secretmask.test.js: no regression tests for the above --> FIXED (7bdd7459)
- [WARNING] engine/secretmask.js: a held key with its own - or _ regrouped with + or / still leaks --> DEFERRED: not a regression (main leaks it the same), named in "Not covered"
- [CONVENTION] .claude/plans/maskgaps-3995.md: weakest premise untested --> FIXED (the creep case is now tested)
- [NIT] engine/secretmask.js: stale comments on reach and SPLIT_REACH --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** not recorded
- [WARNING] engine/secretmask.js: the reach anchor is the run start, not the piece --> FIXED (2ed0dbf3: comment says so; conservative)
- [WARNING] engine/secretmask.js: the unpunctuated copy adds about 65ms on a 50,000-character reply --> DEFERRED: linear, inside the stated budget; recorded in the comment
- [NIT] same anchor comment --> FIXED

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** not recorded
- [BLOCKER] engine/secretmask.js: a / + or = inside the key's first four characters hid its opening, so the new variant was never reached --> FIXED (84518653)
- [WARNING] engine/secretmask.js: the + / = variant made text dense with paths and sums hit the budget (4 of 20 trials withheld) --> FIXED (84518653: only key-like runs; 0 of 20)
- [WARNING] engine/secretmask.js: the separator-stripped fragment match masked whole runs with their labels --> FIXED (84518653)
- [NIT] a symbol-cut password's symbols showed between masks --> FIXED (84518653)
- [NIT] spaces around symbols with no opening --> DEFERRED: named in "Not covered"
- [NIT] a 180-character comment line --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 new WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** not recorded
- [WARNING] the all-lowercase, digitless group joined by + / = leaks --> duplicate of the iteration 3 deferral (named in "Not covered"); skipped
- [NIT] engine/secretmask.js: fragmentsIn's first pass masks a whole run including a path before the key --> pre-existing line, not changed here
**Converged** -- no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | engine/secretmask.js | BRANCH | reach creep withheld prefix guides | FIXED | 7bdd7459 |
| 2 | 1 | BLOCKER | engine/secretmask.js | BRANCH | bare prefix mention masked | FIXED | 7bdd7459 |
| 3 | 1 | WARNING | engine/secretmask.js | BRANCH | unpunctuated copy swallowed glued text | FIXED | 7bdd7459 |
| 4 | 1 | WARNING | engine/secretmask.test.js | BRANCH | label made three cases pass on main | FIXED | 7bdd7459 |
| 5 | 1 | WARNING | engine/secretmask.test.js | BRANCH | no regression tests | FIXED | 7bdd7459 |
| 6 | 1 | WARNING | engine/secretmask.js | BRANCH | own - or _ regrouped with + / | DEFERRED | same on main; Not covered |
| 7 | 1 | CONVENTION | .claude/plans/maskgaps-3995.md | BRANCH | weakest premise untested | FIXED | 7bdd7459 |
| 8 | 2 | WARNING | engine/secretmask.js | BRANCH | reach anchor comment | FIXED | 2ed0dbf3 |
| 9 | 2 | WARNING | engine/secretmask.js | BRANCH | +65ms on 50K punctuation | DEFERRED | inside budget; commented |
| 10 | 3 | BLOCKER | engine/secretmask.js | BRANCH | separator inside the opening | FIXED | 84518653 |
| 11 | 3 | WARNING | engine/secretmask.js | BRANCH | dense paths withheld | FIXED | 84518653 |
| 12 | 3 | WARNING | engine/secretmask.js | BRANCH | stripped match took labels | FIXED | 84518653 |

### Outstanding questions (ASKED, still unresolved when the run ended)
- None.

### NITs (non-blocking, across all iterations)
- [NIT] spaces around symbols with no opening (iteration 3, deferred, Not covered)
- [NIT] fragmentsIn masks a whole run including a path before the key (iteration 4, pre-existing)

### Strengths (across all iterations)
- Each mechanism has a case only it catches, and each was removed in turn to show its test goes red.
- Ordinary text with / + = (URLs, arithmetic, and/or), JSON, CSV and punctuation-heavy prose stays unmasked.
- Gap 4 (chunks of three or fewer) is left open on the card with its reason.
