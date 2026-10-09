---
pre_challenge: true
method: challenge-loop
branch: waitingtile-5540
diff_hash: bb54ceabfd84d50d5461a066b823ccba8eb3dafae9d385ccb8a4da46d7ee6c49
validation: passed (rebased on origin/main; full node suite 17505 tests, 17271 pass, 0 fail; both browser-check gates pass; render-workchip-zero-2157 18/18 on chromium and webkit with the new Waiting arms; render-agent-pill-3958 and render-chip-filters-3423 pass; the floored-zero hide and the floor guard measured red by mutation)
subdir_audit: passed
timestamp: 2026-10-09T07:41:18Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (opus, sonnet; each blind)
**Converged:** Yes (iteration 2: nothing above NIT)
**Total findings:** 0 BLOCKERs, 1 WARNING, about 9 NITs
**Fixed:** the WARNING and most NITs; two recorded with reasons (a crash-loop overlap shared with Working and Idle; the shared pause glyph, noted for the row's owner) | **Asked (awaiting user):** 0

The change (kosmos#5540, decided on the card under the standing rule; the row's owner told first): a Waiting tile on the home row counts agents in state `blocked`, with the card's pause glyph, after Idle and before Issue, floored with unknowns, hidden at zero (a floored zero too), never counting the guide, and "?" on a failed poll.

### Per-Iteration Breakdown

#### Iteration 1 (opus)
- [WARNING] no test held the tile hidden at a floored "0+" --> FIXED (red by mutation).
- [NIT] x4: a comment's count, the CARD_ST name, a guide in the fixture, a working CONTROL --> FIXED.
- [NIT] x2: crash-loop overlap, shared glyph --> RECORDED (plan and card).

#### Iteration 2 (sonnet)
- [NIT] x2: the floor guard now covers Waiting and reads up to the Issue write; comments name the three state tiles --> FIXED. Nothing above NIT: converged.
