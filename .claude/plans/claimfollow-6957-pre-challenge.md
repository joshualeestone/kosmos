---
pre_challenge: true
method: challenge-loop
branch: claimfollow-6957
diff_hash: 7b534fd08dc1eb0714f1b28c9a1ea6051a03e7003815a3983d96b266c549f5e3
validation: passed
subdir_audit: passed
timestamp: 2026-10-23T10:48:25Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8, the cap under Splinter's 10-22 11:08 usage rule.
**Converged:** No. It stopped at the cap with **no BLOCKER open**, as the rule allows. Round 8's warning and nits are follow-up **#6974** (filed, unclaimed).
**After the cap:** one narrowing, NOT re-reviewed. `help` was removed from the "can/could someone else" hand-off verbs, so "@bob can someone else help you with this?" stays bob's. It only takes back an opening this branch added, it adds no new logic, and it has its own test with a control.
**Validation:** the Mortals full suite on head fe3fca0c05, rebased onto main after #6952 merged: **23518 tests, 0 failed**. Validation hash 7b534fd08dc1 is the same diff this proof hashes.

### Per-iteration breakdown (details per round are in claimfollow-6957.md)
#### Iteration 1: 1 BLOCKER, 4 WARNING
- [BLOCKER] the 30-minute cap changed only the refusal's wording; a post dated ahead still held for hours --> FIXED (a post dated more than a minute ahead is open)
- [WARNING] "anyone around", "need someone to" and "anyone else?" opened requests plainly for bob --> FIXED
- [WARNING] the person's old 🙋 attached to the next holder --> FIXED (claimAgreed)
#### Iteration 2: 0 BLOCKER, 3 WARNING
- [WARNING] "need someone to" opened a go-ahead reply; clause starts missed a new line and dashes; "@bob, who...?" read the comma as a clause start --> FIXED
#### Iteration 3: 0 BLOCKER, 2 WARNING
- [WARNING] a dash after the name, and a greeting before it, defeated the @-name strip --> FIXED
#### Iteration 4: 0 BLOCKER, 2 WARNING
- [WARNING] "someone else" phrasings read as bob's; the author exemption locked bob out with no time limit --> FIXED (else handled; exemption removed)
#### Iteration 5: 0 BLOCKER, 2 WARNING
- [WARNING] will/would anyone else opened questions to bob; the every-asked-member release rule was untested --> FIXED
#### Iteration 6: 0 BLOCKER, 2 WARNING
- [WARNING] the reserved-name refusal sent agents to a rename that changes nothing; "could someone else have..." opened bob's post --> FIXED
#### Iteration 7: 0 BLOCKER, 2 WARNING
- [WARNING] the @-name strip worked only at the start of the post; the "someone else" skip list kept growing --> FIXED (strip at every clause start; allowlist of hand-off verbs)
#### Iteration 8: 0 BLOCKER, 1 WARNING (the cap)
- [WARNING] help phrasings opened bob's post, and a helper's claim locked bob out with no time limit --> `help` removed after the cap (above); "who can help you?" after a clause start DEFERRED to #6974

### Weakest premise
That a give-back means the asked member is done with it. Beyond that, the asked rule is a word pattern: the window bounds a misread lock, but a misread open lasts as long as the claim, which is why #6974 tightens the open direction.
