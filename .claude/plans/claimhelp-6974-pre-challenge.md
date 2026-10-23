---
pre_challenge: true
method: challenge-loop
branch: claimhelp-6974
diff_hash: 982b313e48e3c3b35e375374a76539edd238c6ffa212096479ee4211e12c472b
validation: passed
subdir_audit: passed
timestamp: 2026-10-23T12:50:14Z
iterations: 4
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4, under the 8-round cap of Splinter's 10-22 11:08 usage rule.
**Converged:** No, but only on test and plan coverage. Round 4 found no BLOCKER and no WARNING, just 2 NITs. Both were fixed in tests and the plan alone, with no engine change, and were NOT re-reviewed: four lookahead words gained a test each (each one goes red with its word removed), and one bounded "else" phrasing is written into Not in scope.
**Direction check (round 4):** fuzzing 97,812 generated phrasings, main against the branch: 0 opened that main kept for bob. Every new alternative matches a subset of main's.
**Validation:** the Mortals full suite on head b167bae1ab: **23520 (23186 passed, the rest skipped) tests, 0 failed**. Validation hash 982b313e48e3 is the same diff this proof hashes.

### Per-iteration breakdown (details per round are in claimhelp-6974.md)
#### Iteration 1: 0 BLOCKER, 3 WARNING
- [WARNING] the help-for lookahead was only on the "who" rule; "can someone help you?" and "anyone around to help him?" still opened --> FIXED (CLAIM_HELP_FOR on the sibling forms; come/please/also allowed before help)
- [WARNING] the clause-start anchor covered only the "else" form, so adding "else" moved a post toward bob --> FIXED (the anchor covers both forms)
- [WARNING] the anchor dropped question lead-ins ("is anyone around to...", "does anyone else have time...") --> FIXED
#### Iteration 2: 0 BLOCKER, 3 WARNING
- [WARNING] no word boundary after you/him/her/them, so "Herman" and "Youssef" read as bob --> FIXED (\b; "you guys/all/folks" is the room)
- [WARNING] the anchor flipped real room asks led by a conjunction with no punctuation to bob --> FIXED (so/and/or/but/then lead-ins)
- [WARNING] "help him/her/them" can name a third party --> ACCEPTED (bounded lock; in the plan's Not in scope)
#### Iteration 3: 0 BLOCKER, 2 WARNING
- [WARNING] "Can someone else help you?" after a clause start still opened ("else" not allowed before help) --> FIXED (else/here/pls/quickly)
- [WARNING] bare and/or lead-ins opened "@bob ask Ann or anyone free to pair on it" --> FIXED (dropped; ", or" kept for that rule only, not in CLAIM_LEAD, where it would open "broken for you, or anyone else?")
- [NIT] whoever and volunteers forms had no help-for lookahead --> FIXED
#### Iteration 4: 0 BLOCKER, 0 WARNING
- [NIT] four lookahead words untested --> FIXED (tests; not re-reviewed)
- [NIT] "Thanks @bob! Anyone else free to take it?" now locks to bob, not named in the plan --> DOCUMENTED (bounded)

### Weakest premise
The asked rule is still a word pattern. This card narrows the phrasings it names in the unbounded direction (a misread open lasts as long as the claim); others will exist. The 30-minute window bounds a misread lock only.
