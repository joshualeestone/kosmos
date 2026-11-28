---
pre_challenge: true
method: challenge-loop
branch: heavyquiet-9246
diff_hash: 8e95b82c2b66bc359af16758955c06395c57b4242bd4f25ca5ef513addf9e17c
validation: passed
subdir_audit: passed
timestamp: 2026-11-28T06:57:27Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped after iteration 8 by Splinter's usage rule (Fleet Builders m510, 2026-10-26). No BLOCKER was
open; round 8 found only NITs.
**Total findings:** 2 BLOCKERs, 7 WARNINGs and 28 NITs over 8 rounds.
- **BLOCKERs:** both in round 3, both in my own round-2 test arm.
- **WARNINGs:** 2, 0, 0, 2, 0, 1, 2 and 0, by round.
**Fixed:** every BLOCKER; every WARNING but one answered by statement (round 6: the emoji case, NOT DONE, on the card) | **Deferred:** NITs listed per round | **Asked:** 0

Harness tools/test-queued-heavy-4977.sh: 224 OK, 0 BAD (217 before; seven #9246 arms). Seven mutations, one run
(D/mut9246.sh, 2026-11-28 00:01), each red on its own arms:
- the physical-path compare;
- "any resolvable folder is real";
- U+202E, U+3000 and NBSP each dropped from the byte list;
- the ASCII-control strip.

**Closing validation.** Full validation of 0e06a05f51 passed: 31882 node tests, 0 failures, the harness 224 OK / 0 BAD inside it, rc 0, audit rc 0, clean tree, head unchanged. No overlap with main (measured 00:56 CST).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0
- [WARNING] [[:cntrl:]] alone left C1, U+2028/9, direction marks and the BOM under a C locale (measured) --> FIXED (4a69db05e2, byte list)
- [WARNING] a sandbox HOME naming its own folder counts as real --> ANSWERED (4a69db05e2, the plan's weakest premise)
- [NIT] three FIXED (dead trailing-slash loop, CDPATH, comment), one no change

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0
- [NIT] three FIXED (non-ASCII spaces, one function plus a board-derived arm, a line number), one no change

#### Iteration 3
**Reviewer model:** opus
**New findings:** 2 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 2 (both in my round-2 arm)
- [BLOCKER] the board-text arm read the shim, the wrong engine path and the stand-in node inside the harness (measured) --> FIXED (4d97d6b99d)
- [BLOCKER] bash 3.2 ignores a temporary LC_ALL on a function call, so both locale passes were one (measured) --> FIXED (4d97d6b99d)
- [NIT] two FIXED, three no change

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] the arm went red on a computer with no UTF-8 locale --> FIXED (7e3b4fc83c, the C pass alone, named)
- [WARNING] the same locale dependency, a second way --> FIXED (7e3b4fc83c)
- [NIT] one FIXED, two no change

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [NIT] two FIXED (plan list, "normally exists"), one to the PR body (item 1 fixed a third way)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] the card's emoji case (past 80 UTF-16 units) is still refused --> ANSWERED (8a136cb1c9, NOT DONE, stated on the card 7233111317 and in the PR)
- [NIT] one FIXED (the arm starts at U+0001: 194 rows), two no change

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 (WARNING 1: my plan claimed a card note not yet posted)
- [WARNING] the plan claimed the emoji note was on the card --> FIXED (b4db7b4e6d, posted)
- [WARNING] the only negative arm ran with the real HOME --> FIXED (b4db7b4e6d, an arm with the real folder present)
- [NIT] one FIXED, two no change

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [NIT] two FIXED (the negative arm named a control; an end-to-end NBSP arm), one no change

### Final Ledger

| # | Iter | Severity | Finding | Resolution |
|---|---|---|---|---|
| 1 | 1 | WARNING | C-locale strip gap | FIXED 4a69db05e2 |
| 2 | 1 | WARNING | sandbox HOME counts as real | ANSWERED 4a69db05e2 |
| 3 | 3 | BLOCKER | arm read the shim and stand-in node | FIXED 4d97d6b99d |
| 4 | 3 | BLOCKER | both locale passes ran in one | FIXED 4d97d6b99d |
| 5 | 4 | WARNING | arm red with no UTF-8 locale | FIXED 7e3b4fc83c |
| 6 | 4 | WARNING | same, a second way | FIXED 7e3b4fc83c |
| 7 | 6 | WARNING | emoji case still refused | ANSWERED 8a136cb1c9 (not done, stated) |
| 8 | 7 | WARNING | plan claimed an unposted note | FIXED b4db7b4e6d |
| 9 | 7 | WARNING | negative arm with the real HOME | FIXED b4db7b4e6d |

### NITs (non-blocking, across all iterations)
Listed under each iteration.

### Strengths (across all iterations)
The characters stripped are checked against the board's own normalizeLabel, so the list cannot drift from the rule
it serves. Every arm was proved red by a mutation in one queued run.
