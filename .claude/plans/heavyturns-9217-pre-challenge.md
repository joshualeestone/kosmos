---
pre_challenge: true
method: challenge-loop
branch: heavyturns-9217
diff_hash: 41a3abd7729b604bc56e01c8673b1fa826700c19273dad87e57e305722a7d605
validation: passed
subdir_audit: passed
timestamp: 2026-11-28T06:29:17Z
iterations: 9
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 9
**Converged:** No. Splinter's usage rule (Fleet Builders m510, 2026-10-26) stops at 8 unless a BLOCKER is open. Round 8
had one, so round 9 ran. Round 9 found no BLOCKER, so the loop stopped there. Its four WARNINGs were fixed without a
further review round; each has an arm proved red by mutation.
**Total findings:** 2 BLOCKERs, 21 WARNINGs and 40 NITs over 9 rounds.
- **BLOCKERs:** rounds 7 and 8, both in my own fixes from the round before.
- **WARNINGs:** 3, 2, 4, 0, 2, 3, 1, 2 and 4, by round.
**Fixed:** every BLOCKER and every WARNING but the ones answered by statement below | **Deferred:** NITs listed per round, to the PR body | **Asked:** 0

Every code fix has an arm that a mutation turned red: 7 for the first build, then the arms in
D/mut-turns-r1..r9.sh (each run: the arm named fails, the file restored, the tree clean). Browser check
render-heavy-9217.js: 10/10 on this branch, and on a board from origin/main exactly its 3 new arms fail.

**Closing validation.** Full validation of 3455ed2936 (rebased onto main after #9258) passed: 31996 node tests, 0 failures, rc 0, audit rc 0, clean tree, head unchanged. Main then moved, touching install/kosmos and tools/windows/kosmos-cli.js; the merge is clean and, run on the merged tree in a throwaway worktree, the CLI heavy, help, parity and verb tests pass 152/152 (00:29 CST).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 0
- [WARNING] the line's reads skipped slice 1's ps cap (measured 20 and 40 runs) --> FIXED (ba355f06e9)
- [WARNING] the take route never started a missing agent's grace --> FIXED (ba355f06e9; it also exposed waiting() leaving a gone place in the file, fixed)
- [WARNING] the board showed places the read could not check --> FIXED (ba355f06e9)
- [NIT] four FIXED (display names, release hint, holder re-announce, grace wording), two DEFERRED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0
- [WARNING] one ps budget held only inside take(); a status read built two, a take route three --> FIXED (89cb9f3785)
- [WARNING] the take route's refresh repeated the take's work --> FIXED (89cb9f3785, shares the budget)
- [NIT] two FIXED (an unchecked job holds the turn; Windows indentation), two DEFERRED

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 7 NITs
**Self-generated:** 0
- [WARNING] a --pid place had no ceiling (measured at 100 h) --> FIXED (f6bd157998, 30 min idle limit)
- [WARNING] the board could name as next an agent that stopped asking --> FIXED (f6bd157998, same limit)
- [WARNING] exit 3 already meant "maybe" on Windows --> FIXED (f6bd157998, wait exits 10)
- [WARNING] the ps comment claimed more than the code --> FIXED (f6bd157998)
- [NIT] three FIXED (unchecked holder named not described, usage, browser-check locale), four DEFERRED

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 7 NITs
**Self-generated:** 0
- [NIT] five FIXED (Windows-only "maybe", plan, doc block, a dead 'hide' comment, the caller's own lapsed place), two DEFERRED

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0
- [WARNING] the loop I posted on the card stopped on any exit but 10 --> FIXED (e2ba4b5bbf, usage and card corrected)
- [WARNING] a round-3 control could not fail (measured) --> FIXED (e2ba4b5bbf)
- [NIT] two FIXED (--pid guidance, the card's ps claim), three DEFERRED

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0
- [WARNING] an agent waited behind its own job --> FIXED (e7da263c45; the fix itself was wrong, see iteration 7)
- [WARNING] the Windows timeout arm could not see a regression to 0 --> FIXED (e7da263c45, asserts 3)
- [WARNING] the lineNotSaved comment read safer than it is --> FIXED (e7da263c45)
- [NIT] four DEFERRED

#### Iteration 7
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 (the BLOCKER was my iteration-6 change)
- [BLOCKER] excluding the caller's own jobs from busy let one agent hold several turns and run a waiter's grace (measured) --> FIXED (cfdb48546b)
- [WARNING] the CLI said "the turn is free for B" while the caller's job blocked B --> FIXED (cfdb48546b)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 1 (the BLOCKER was my iteration-7 move)
- [BLOCKER] the move ended the old record before the wrapper's existed; a failed start lost the turn (measured) --> FIXED (4e32fc0c20)
- [WARNING] the move replaces the record whatever the label --> FIXED (4e32fc0c20, stated in the usage)
- [WARNING] no arm for the half-failure --> FIXED (4e32fc0c20)

#### Iteration 9
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 2 (WARNINGs 1 and 2 came from my iteration-8 code)
- [WARNING] a failed end was never cleaned up (measured) --> FIXED (143b7c9f54)
- [WARNING] a bare record moved beside another own job: two turns (measured) --> FIXED (143b7c9f54)
- [WARNING] release said the turn was gone while another record held it --> FIXED (143b7c9f54)
- [WARNING] the usage gave no polling interval --> FIXED (143b7c9f54)
- [NIT] five DEFERRED

### Final Ledger

| # | Iter | Severity | Finding | Resolution |
|---|---|---|---|---|
| 1 | 1 | WARNING | ps cap skipped | FIXED ba355f06e9 |
| 2 | 1 | WARNING | take never started a missing agent's grace | FIXED ba355f06e9 |
| 3 | 1 | WARNING | board showed unchecked places | FIXED ba355f06e9 |
| 4 | 2 | WARNING | one ps budget only inside take | FIXED 89cb9f3785 |
| 5 | 2 | WARNING | take route's extra read | FIXED 89cb9f3785 |
| 6 | 3 | WARNING | --pid place with no ceiling | FIXED f6bd157998 |
| 7 | 3 | WARNING | stale "next" on the board | FIXED f6bd157998 |
| 8 | 3 | WARNING | exit 3 meant maybe | FIXED f6bd157998 |
| 9 | 3 | WARNING | ps comment | FIXED f6bd157998 |
| 10 | 5 | WARNING | unsafe loop on the card | FIXED e2ba4b5bbf |
| 11 | 5 | WARNING | a control that could not fail | FIXED e2ba4b5bbf |
| 12 | 6 | WARNING | waiting behind one's own job | FIXED e7da263c45, then corrected cfdb48546b |
| 13 | 6 | WARNING | weak Windows timeout arm | FIXED e7da263c45 |
| 14 | 6 | WARNING | lineNotSaved comment | FIXED e7da263c45 |
| 15 | 7 | BLOCKER | one agent, several turns | FIXED cfdb48546b |
| 16 | 7 | WARNING | false "turn is free" message | FIXED cfdb48546b |
| 17 | 8 | BLOCKER | move lost the turn on a failed start | FIXED 4e32fc0c20 |
| 18 | 8 | WARNING | move replaces any bare record | FIXED 4e32fc0c20 (stated) |
| 19 | 8 | WARNING | no half-failure arm | FIXED 4e32fc0c20 |
| 20 | 9 | WARNING | failed end never cleaned | FIXED 143b7c9f54 |
| 21 | 9 | WARNING | bare move beside another job | FIXED 143b7c9f54 |
| 22 | 9 | WARNING | false release message | FIXED 143b7c9f54 |
| 23 | 9 | WARNING | no polling interval | FIXED 143b7c9f54 |

### NITs (non-blocking, across all iterations)
Listed under each iteration; the deferred ones are in the PR body.

### Strengths (across all iterations)
The holder is the slice 1 record itself, so there is no second copy of who has the turn. Every code fix has an arm
proved red by mutation, including two BLOCKERs found in my own fixes.
