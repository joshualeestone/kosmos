---
pre_challenge: true
method: challenge-loop
branch: taskdup-5319
diff_hash: e4e5c73d257cb9a56e2840ba846b60bd2c5b02fb9974c7d58eaefc8ff3d39f23
validation: passed (focused at 9daf4cac9: 259 related and audit test files, 5806 tests, 0 fail; the full suite and FULL browser checks run after this proof)
subdir_audit: passed (no subdirectory CLAUDE.md in the diff)
timestamp: 2026-10-05T17:20:57Z
iterations: 9
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 9. Reviewers were fresh and blind, alternating opus (odd rounds) and sonnet (even rounds).
**Converged:** Yes. Round 9 found no BLOCKER or WARNING.
**Shape of the loop:** rounds 1 to 3 kept finding false matches in fuzzy rules, so round 3 CUT the match to the same text. Rounds 4 to 8 each narrowed it further, in the safe direction: a false match makes an agent close a real task, while a miss costs only today's behaviour. Every false-match case found is now a test row that must not match. Details per round are in .claude/plans/taskdup-5319.md.

### Per-Iteration Breakdown
- [WARNING] round 1: two racing adds could both be told to close themselves --> FIXED e2e09be88 (only older tasks)
- [WARNING] round 1: version numbers and short or negated text matched --> FIXED e2e09be88
- [WARNING] round 2: v2/v3, Q3/Q4 and one-word-apart four-word tasks matched --> FIXED 7279b7bfb
- [BLOCKER] round 3: long tasks one word apart, and a negation, still matched --> FIXED d03b90ac5 (cut to the same text)
- [WARNING] round 3: swapped order, and extra name words, matched --> FIXED d03b90ac5
- [WARNING] round 4: signs and symbols were dropped (-5 / 5, x > 5 / x < 5) --> FIXED dfd6f3e21 (every character counts)
- [WARNING] round 5: NFKC folded x² into x2 --> FIXED 2d130c0e5 (NFC)
- [WARNING] round 6: generic subtask text under two parents matched --> FIXED 1c48983ca (same parent only)
- [WARNING] round 7: the same sentence for another detail or person matched --> FIXED 9e6b9ffc4
- [WARNING] round 7: no route test for the parent passthrough --> FIXED 9e6b9ffc4 (with a control)
- [WARNING] round 8: an older task already under way matched --> FIXED e102cd19a
- [WARNING] round 8: the note was read after an await --> FIXED e102cd19a
- [NIT] round 9: unpaired surrogates survived into the note --> FIXED 9daf4cac9
- NITs fixed along the way: closest/oldest order, the parent, control and invisible characters stripped, names (sameTextOpen), the plan's sections, the zsh-free test file. Not changed: the macOS test runs the CLI's sed line, not the whole command (the repo's pattern); case folding of Greek final sigma (a miss only).

### Final Ledger
| # | Iter | Cat | File | Origin | Description | Status |
|---|---|---|---|---|---|---|
| 1 | 1 | W | engine/tasks.js | SELF | racing adds both close | FIXED |
| 2 | 1 | W | engine/tasks.js | SELF | versions/short/negated text matched | FIXED |
| 3 | 2 | W | engine/tasks.js | SELF | letter+digit tokens, loose overlap | FIXED |
| 4 | 3 | B | engine/tasks.js | SELF | one word apart, negation | FIXED |
| 5 | 3 | W | engine/tasks.js | SELF | order, extra names | FIXED |
| 6 | 4 | W | engine/tasks.js | SELF | symbols dropped | FIXED |
| 7 | 5 | W | engine/tasks.js | SELF | NFKC folding | FIXED |
| 8 | 6 | W | engine/tasks.js | BRANCH | subtasks under two parents | FIXED |
| 9 | 7 | W | engine/tasks.js | BRANCH | another detail or person | FIXED |
| 10 | 7 | W | server.task-same-text-5319.test.js | BRANCH | no route parent test | FIXED |
| 11 | 8 | W | engine/tasks.js | BRANCH | task already under way | FIXED |
| 12 | 8 | W | server.js | BRANCH | note read after await | FIXED |
| 13 | 9 | N | server.js | SELF | unpaired surrogates | FIXED |
