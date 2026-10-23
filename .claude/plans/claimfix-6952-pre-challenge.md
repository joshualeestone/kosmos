---
pre_challenge: true
method: challenge-loop
branch: claimfix-6952
diff_hash: 159a06bf04bac173e86a8080daccb5f039dad518f3d6590260b34f8c3bc50df0
validation: passed
subdir_audit: passed
timestamp: 2026-10-23T09:38:55Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8, the cap under Splinter's 10-22 11:08 usage rule.
**Converged:** No. It stopped at the cap with **no BLOCKER open**, as the rule allows. Round 8's two warnings are follow-up **#6957** (claimed: icecreamkitty; branch claimfollow-6957, stacked on this one).
**Validation:** the Mortals full suite on head 78e07a50cd (rebased onto main after #6946 merged): **23476 tests, 0 failed**. Validation hash 159a06bf04ba is the same diff this proof hashes. The previous run failed only cli.busy-health-4466, a timing test, in the same minute as another branch's suite ran beside it. That test passes alone (55/55), and it passed in this solo run.

### Per-iteration breakdown (details per round are in claimfix-6952.md)
#### Iteration 1: 0 BLOCKER, 3 WARNING
- [WARNING] a post naming only a departed member was unclaimable forever --> FIXED (asked members filtered by the room)
- [WARNING] the reactions filter hid the person's own 🙋 --> FIXED (only agents' raised hands are dropped)
- [WARNING] `operator` was reserved only for reacting --> FIXED (also refused at agent creation, any case)
#### Iteration 2: 0 BLOCKER, 2 WARNING
- [WARNING] a quote-reply go-ahead was not asking its answered author --> FIXED (the author of the answered post is asked)
- [WARNING] a named post could never be handed on --> FIXED (later simplified, round 4)
#### Iteration 3: 0 BLOCKER, 1 WARNING
- [WARNING] an agent answering its own post locked the request to itself --> FIXED (not the replier)
#### Iteration 4: 0 BLOCKER, 4 WARNING
- [WARNING] hand-off by an asked member's side question, plus the author and open-post corners --> FIXED (a hand-off is a post of its own)
- [WARNING] doctrine forbade claims the board allows --> FIXED (it defers to the board's refusal)
#### Iteration 5: 0 BLOCKER, 1 WARNING
- [WARNING] any name a post mentions became an exclusive owner --> FIXED (room-ask exceptions; ambiguous @-words open)
#### Iteration 6: 0 BLOCKER, 3 WARNING
- [WARNING] room words in passing opened posts, and "one of you" opened a named post --> FIXED (room words only where they are asked to do the work)
- [WARNING] departed holder and old pill unpinned on the reactions line --> FIXED (route test)
#### Iteration 7: 0 BLOCKER, 2 WARNING
- [WARNING] a word-pattern lock had no way out --> FIXED (the asked members get first call for 30 minutes, then anyone)
- [WARNING] relative clauses and questions for information opened requests --> FIXED (clause-start anchoring)
#### Iteration 8: 0 BLOCKER, 2 WARNING (the cap)
- [WARNING] an asked member who gave the post back still held first call --> DEFERRED to #6957
- [WARNING] common room phrasings still locked for up to 30 minutes --> DEFERRED to #6957

### Weakest premise
That `mentioned` and a word pattern read who a request is for. The 30-minute window bounds a misread that locks a post. A misread that opens a post falls back to first-claim-wins, as before this branch.
