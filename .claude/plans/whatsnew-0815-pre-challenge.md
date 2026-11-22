---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0815
diff_hash: fcbaf2a69e2175afc6184b3a7945a715dbb8e98b87b7eb3557e0045fd4dc762d
validation: passed (Agent1s, validation_log_run_or_skip at 7c31030024: 30,516 node tests, 0 failed, 0 cancelled; all four shell shards status 0; hash fcbaf2a69e21 equals this diff_hash)
subdir_audit: passed (no subdir CLAUDE.md in the diff)
timestamp: 2026-11-22T10:35:15Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** Yes, at iteration 8 (one NIT, no actionable finding). Iteration 8 is also the cap under the operator's standing review-loop rule.
**Total findings:** 23 (0 BLOCKERs, 12 WARNINGs, 0 CONVENTIONs, 11 NITs)
**Fixed:** 12 WARNINGs and 6 NITs | **Deferred:** 0 | **Asked (awaiting user):** 0
Mona Lisa's copy read (fleetreleases m5879) was also taken: two lines reworded.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above (ITER_COMMITS was empty)
- [WARNING] release/whats-new-pool.json - two Windows-only highlights were already in a shipped window --> FIXED (b27953ce02): retired by hand (shown, shownIn 0.8.03), per the tool's header
- [WARNING] plan - the "Rejected" reason was false (items lose on rank, not as notes) --> FIXED (b27953ce02)
- [WARNING] plan - the weakest premise named the wrong premise --> FIXED (b27953ce02)
- [NIT] "on the computer" vague --> FIXED (b27953ce02), revised again in iteration 3
- [NIT] "never applied here" --> no action (the line was retired)
- [NIT] Mac gets only 2 lines --> resolved by the retirements (Mac 4)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above
- [WARNING] the chat-spacing line was in 0.8.01 to 0.8.05's shipped windows (Windows saw it) --> FIXED (ce5301ea13) by a mac tag, then REVERSED in iteration 3 (see there)
- [WARNING] plan never checked untagged items for Windows exposure --> FIXED (ce5301ea13)
- [NIT] the Windows premise stated, not verified --> no action (named as the weakest premise)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 2 of the above (the mac tag and the plan wording, both from iteration 2's fix)
- [WARNING] a mac tag hides the line from Linux too (platformOf gives Linux no tag) --> FIXED (5dfa55b32f): untagged again; DECISION recorded: a repeated true line on Windows costs less than a missing one on Linux
- [WARNING] plan misstated the rank margin --> FIXED (5dfa55b32f)
- [WARNING] weakest premise incomplete --> FIXED (5dfa55b32f)
- [NIT] "in the app on your computer" narrower than the change --> FIXED (5dfa55b32f)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above (the plan)
- [WARNING] plan understated the chat-spacing line's exposure (0.8.01, 0.8.03, 0.8.04, 0.8.05) --> FIXED (d9321a44e4)
- [NIT] Linux history stated as fact --> FIXED (d9321a44e4): stated as an assumption
- [NIT] retirement rests on the weakest premise --> no action (already named)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] "A paused room says why it stayed quiet" describes an agent-only note (engine/messages.js), which a person would read as the Pause button --> FIXED (902dad22d5): notesOnly; "A new Cloud machine can be allowed" takes the slot (in no earlier window, searched with a positive control)
- [NIT] plan's shownIn wording --> FIXED (902dad22d5)
- [NIT] 0.8.04's file has no "also" --> FIXED (902dad22d5)
- [NIT] "with a note" vs the board's "on a note" --> FIXED (902dad22d5)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] the restart-note line's mac tag hides it from Linux; same logic as the chat-spacing line --> FIXED (0d883afb71) by untagging, then REVERSED in iteration 7 (see there)
- [NIT] some plan claims rest on memory --> no action (named)
- [NIT] Cloud-machine wording stiff but accurate --> no action

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 2 of the above (both from iteration 6's fix)
- [WARNING] the restart note's mac tag is deliberate (every earlier window; whatsnew-0801.md: on Windows it can name an agent that came back), so untagged the line could be false on Windows --> FIXED (7c31030024): mac tag restored; DECISION: a missing line on Linux costs less than a partly false one on Windows
- [WARNING] plan called the restart note a Windows repeat --> FIXED (7c31030024)
- [NIT] pronoun --> FIXED (7c31030024)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above
- [NIT] the plan's final list reads as more hand edits --> no action
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | release/whats-new-pool.json | BRANCH | two Windows-only lines already shown | FIXED | b27953ce02 |
| 2 | 1 | WARNING | plan | BRANCH | false rejected reason | FIXED | b27953ce02 |
| 3 | 1 | WARNING | plan | BRANCH | wrong weakest premise | FIXED | b27953ce02 |
| 4 | 2 | WARNING | release/whats-new-pool.json | BRANCH | chat line shown on Windows | FIXED | 5dfa55b32f (final form) |
| 5 | 2 | WARNING | plan | SELF | untagged items unchecked | FIXED | ce5301ea13 |
| 6 | 3 | WARNING | release/whats-new-pool.json | SELF | mac tag hides Linux | FIXED | 5dfa55b32f |
| 7 | 3 | WARNING | plan | SELF | rank margin | FIXED | 5dfa55b32f |
| 8 | 3 | WARNING | plan | SELF | premise incomplete | FIXED | 5dfa55b32f |
| 9 | 4 | WARNING | plan | SELF | exposure understated | FIXED | d9321a44e4 |
| 10 | 5 | WARNING | release/whats-new-pool.json | BRANCH | agent-only line shown to people | FIXED | 902dad22d5 |
| 11 | 6 | WARNING | release/whats-new-pool.json | BRANCH | restart note hidden from Linux | FIXED then reversed | 7c31030024 |
| 12 | 7 | WARNING | release/whats-new-pool.json | SELF | untagged restart note false on Windows | FIXED | 7c31030024 |

### NITs (non-blocking, across all iterations)
- some plan claims rest on memory (iteration 6)
- Cloud-machine wording slightly stiff (iteration 6)
- the plan's final list layout (iteration 8)

### Strengths (across all iterations)
- The built window always equalled the tool's choose() on the committed pool; web/whats-new.json was never hand-edited
- The five shownIn 0.8.14 items are exactly 0.8.14's own window at cbffbf3438
- Every line checked against every v08NN window from 0.8.00 to 0.8.14; every repeat and omission per platform is stated in the plan
