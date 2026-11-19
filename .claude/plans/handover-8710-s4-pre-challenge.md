---
pre_challenge: true
method: challenge-loop
branch: handover-8710-s4
diff_hash: 49cd432b7b57055721bb92c1672c6fb71f1b05b28686bfcb45e4f24c79464661
validation: passed
subdir_audit: passed
timestamp: 2026-11-19T19:57:37Z
iterations: 9
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 9 (8 under Splinter's cap, plus a targeted 9th for the BLOCKER round 8 found)
**Converged:** No (stopped at the cap; round 9's one WARNING fixed; leftovers with reasons on kosmos#8738)
**Validation:** full tools/run-tests.sh ON MORTALS (mortals-validate.sh) at 36d7653aff, after the rebase onto main
a149e6e254 (slice 3, PR #8751, merged): node tests 30,002 = 29,389 pass + 613 skipped, 0 failed, 0 cancelled; entry
status clean, base a149e6e254, hash 49cd432b7b57 (equal to this diff_hash). The rebase changed no line of slice 4's
own diff (same 8 files, identical changed lines); only the base moved. Earlier run, before the rebase: 37ddb3b8e5,
hash c89ff23dec32, with slice 3 in the diff.

### Per-Iteration Breakdown (slice 4's own commits; slice 3's rounds are in its own proof)

#### Iteration 1
**Reviewer model:** opus
- [BLOCKER] engine/handoverrecv.js: a hand-over that can never succeed retried every tick, never reported --> FIXED (62d15a74f3)
- [WARNING] lost /done made a second copy; manifest missing final at once; uncapped manifest and budget; maxBytes dropped; keys outside the prefix; finals not told; secret kept --> FIXED (62d15a74f3)

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] counts in memory only; starved rows; world folder kept; crash between finish and mark; temp key file kept --> FIXED (b69796dcce)

#### Iteration 3
**Reviewer model:** opus
- [WARNING] refusal not noted (re-download); disk blamed on sender; cleanup could delete a person's work; stale keys kept --> FIXED (2f373f9fdf)

#### Iteration 4
**Reviewer model:** sonnet
- [WARNING] refused /done stopped the tick; outage spent attempts; crash-after-finish duplicate; orphan Kosmos; data root unchecked --> FIXED (baabc2d299)

#### Iteration 5
**Reviewer model:** opus
- [WARNING] one empty /mine lost a waiting key; outage forever; finished copy re-received; half-made Kosmos left; transient key error final; partial finish re-received --> FIXED (8bbac98239)

#### Iteration 6
**Reviewer model:** sonnet
- [WARNING] partial finish reported done; finished copy tidied; transient key replaced; manifest failure classes; uncovered chunks --> FIXED (97d0c6a7df)

#### Iteration 7
**Reviewer model:** opus
- [WARNING] stuck re-finish duplicate; restore folder removed after a finish; local failures blamed; hidden copies --> FIXED (69c5482dc2)

#### Iteration 8
**Reviewer model:** sonnet
- [BLOCKER] a throwing restore escaped the attempt counter (round 7's own check) --> FIXED (27b244e4ed)
- [WARNING] key folder follows the active Kosmos --> DEFERRED to kosmos#8738 (reasoned: the tick runs only in the enrolled Kosmos; to be measured)
- [WARNING] URL credentials and ports --> FIXED (27b244e4ed)

#### Iteration 9 (targeted at the round-8 fix)
**Reviewer model:** opus
- [WARNING] a finished copy at the attempt ceiling ended failed --> FIXED (146e476323)

### Full-suite follow-up
- [BLOCKER] rawwrites-8718 (deleteKey overwrite) and windows-tests-1777 (a win32 branch) --> FIXED (37ddb3b8e5)

### Strengths
- An end-to-end test packs with the real packer (slice 3) and receives with this one into a "Handed over" Kosmos.
- Every fix carries a deliberate mutation that turns its test red; several weak tests were found that way and fixed.
