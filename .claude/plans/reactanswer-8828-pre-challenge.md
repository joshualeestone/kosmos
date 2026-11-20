---
pre_challenge: true
method: challenge-loop
branch: reactanswer-8828
diff_hash: e58ddbf7e3cc28717461512d2c8a083914debf48e10c1a361a223892cfc4788f
validation: PENDING (full suite on Mortals via mortals-validate.sh at 7f4f2207f7); affected suites locally 170/170, tree guards 28/28
subdir_audit: not run (no CLAUDE.md in the diff)
timestamp: 2026-11-20T17:00:28Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (blind, one reviewer at a time; rounds 3 to 8 each read the whole branch)
**Converged:** Yes. Round 8 raised no BLOCKER and no SHOULD (NITs only, listed below).
**Total actionable findings:** 2 BLOCKERs, 13 SHOULDs (WARNINGs), NITs as listed
**Fixed:** 2 BLOCKERs, 12 SHOULDs | **Rejected with reasons:** 1 SHOULD-level and several NITs (plan file) | **Asked:** 0

Every round's full review is in the session scratchpad (review-8828-r2.md to r8.md); dispositions are in .claude/plans/reactanswer-8828.md.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 1 BLOCKER
- [BLOCKER] item 1 first build cleared a reacted post from --unanswered; defaults.js says a reaction never answers a post addressed to the reader --> FIXED (016546179d): nothing leaves the list; a line names the reacted posts

#### Iteration 2
**New findings:** 0 BLOCKERs, 3 SHOULDs, 7 NITs
- [WARNING] the line's command could not be run (no project id) --> FIXED (90367a1762)
- [WARNING] an extra pass over the whole log on every agent read --> FIXED: built only under --unanswered from reactionRowsOf
- [WARNING] four of nine mutations survived --> FIXED: tests for unmarked and skin-tone raised hands, claimed listed, several emojis, -n cut, plain read

#### Iteration 3
**New findings:** 0 BLOCKERs, 2 SHOULDs, 5 NITs
- [WARNING] the line told agents to post an answer to a colleague's confirmation (defaults.js:658: a reaction answers it) --> FIXED: both ways out
- [WARNING] check words unquoted in an error --> FIXED in single quotes, since install/kosmos's sed stops at the first double quote (the suggested double-quote fix would have broken it); printed whole

#### Iteration 4
**New findings:** 1 BLOCKER, 2 SHOULDs, 4 NITs
- [BLOCKER] the confirmation sentence showed under the person's post (defaults.js:653) --> FIXED, measured with a person-post test
- [WARNING] item 2's "not the clock" contradicted by a working seat on the same screen --> FIXED, scoped to the seat

#### Iteration 5
**New findings:** 0 BLOCKERs, 1 SHOULD, NITs
- [WARNING] no time said for a confirmation --> FIXED, later removed in round 6
- [NIT made real] a check saying "no task by that number" turned 409 into 404 (MEASURED 404 !== 409) --> FIXED: both routes anchored; a test per route with a 404 control

#### Iteration 6
**New findings:** 0 BLOCKERs, 2 SHOULDs, 6 NITs
- [WARNING] "up to 3 days" false under --all --> FIXED, no age claim
- [WARNING] the person's post got an "If" --> FIXED: its own unconditional line; test with both kinds in one room

#### Iteration 7
**New findings:** 0 BLOCKERs, 1 SHOULD, NITs
- [WARNING] a turn-ends seat was described in time --> FIXED, own clause
- [NIT] a claimed post could be told nothing is needed --> FIXED with a hand-down control; CLI test for the listed refusal added

#### Iteration 8
**New findings:** 0 BLOCKERs, 0 SHOULDs, 6 NITs
- [NIT] old unmarked raised-hand rows, a listed confirmation still counted, waits vs no-report stretches, two quote lookalikes, a doubled backslash in the macOS CLI, an apostrophe inside a check: all minor; recorded, not changed

### Final Ledger
Mutations: each guard in all three items has a mutation that fails its test (recorded per round in the plan file).
