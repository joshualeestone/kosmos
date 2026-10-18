---
pre_challenge: true
method: challenge-loop
branch: memdash-6511
diff_hash: 852c62ebe5139fbdc82bf22c14c845fa2782c13912d7b2b85237f52053174cfc
validation: passed
subdir_audit: passed
timestamp: 2026-10-18T22:30:09Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (fresh blind reviewers: Sonnet, Opus, Sonnet)
**Converged:** Yes. Round 3 had no actionable findings.
**Validation:** passed at bb138bdb6a (hash 21b888530b85), which is this diff before the plan file was added (the plan is one Markdown file; the proof hash below binds both): 22,001 node tests, 0 failed; shell shard 252/252.
**Tests that can fail:** the new #6511 test in web.memory-words.test.js fails on main (control run in a detached
origin/main worktree). Round 2 mutation-checked it four ways: the word restored, the .vh sentence dropped, the .vh
holding the word, and a dash followed by the word. Each one fails.
**Design:** Mona Lisa approved on the card (shots ~/work/design-shots/kosmos-6511).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
- [WARNING] The comment above lrow still recorded the "the word, not a glyph" ruling, which invites a revert --> FIXED (5e37e3fad1).
- [WARNING] The notYet vs unknown distinction is lost for sighted users on the list row --> ACCEPTED: #3501 named both words
  meaningless; the spoken sentence and the agent page keep the distinction. Stated on the card.
- [NIT] The en dash is the only aria-hidden empty marker of its kind --> kept; the design reviewer approved it.

#### Iteration 2
**Reviewer model:** opus
- [WARNING] The "ONE CALL, read twice" comment was now false --> FIXED (bb138bdb6a: the three stale blocks replaced by one true comment).
- [WARNING] "The accessible name is the word plus this span" and "shape and word for the eye" were stale --> FIXED (same commit).
- [NIT] A dropped .vh failed on the dash message, not its own --> FIXED: the sentence is asserted first.
- [NIT] doesNotMatch(memu.word) is redundant with the anchored dash --> removed in the same reorder.

#### Iteration 3
**Reviewer model:** sonnet
- No actionable findings. Every sentence in the new comment is true of the code; no other test or browser check reads
  the list row's word; the test fails with the right message under both mutations.
