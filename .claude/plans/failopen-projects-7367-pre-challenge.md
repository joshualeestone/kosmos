---
pre_challenge: true
method: challenge-loop
branch: failopen-projects-7367
diff_hash: 823ab71d35491cc5c351c7cc5c0a32e11bd9a98a38480cbeac9678dcfb02d9cf
validation: windows: holdstale 18/18, undo 20/21, receipt 27/30 (+2 receipt, +1 undo baselines), messages 188/189 (baseline), taskchat 11/11, room server suites green
subdir_audit: passed
timestamp: 2026-10-27T18:12:28Z
iterations: 8
converged: false
---

# Pre-PR review proof: failopen-projects-7367

**Iterations:** 8
**Converged:** No.
**Per-round record:** .claude/plans/failopen-projects-7367.md

## Rounds

#### Iteration 1
- Round 1: no blocker. [WARNING] a passing read error was cached until the file changed --> FIXED: 5 s, test with a repaired control. [WARNING] no test of recovery after repair --> FIXED: damage/repair test. [NIT] freed-claim test frees no real claim --> ACCEPTED. [NIT] "can only show rows" understated: the unanswered sweep acts --> FIXED: sweep gated.

#### Iteration 2
- Round 2: no blocker. [WARNING] the sweep gate had no test --> FIXED: test with repaired control. [NIT] which-room/valve count a deleted project's last hour --> ACCEPTED (plan). [NIT] record() early returns lacked stampsUnknown --> FIXED. [NIT] plan out of date --> FIXED.

#### Iteration 3
- Round 3: no blocker. [WARNING] the sweep's second read (unanswered) ungated --> FIXED. [WARNING] undo could plan from a deleted task's edits --> FIXED: undo.plan gated, test. [NIT] externalKeptOn comment --> FIXED.

#### Iteration 4
- Round 4: no blocker. [WARNING] hold-stale sweep acts on unfiltered rows --> FIXED: owed() gated, test. [NIT] undo re-check after read --> FIXED. [NIT] #4580 fold --> ACCEPTED (plan).

#### Iteration 5
- Round 5: no blocker. [WARNING] hold-stale timer read rows without their stamps; owed had no after-read check --> FIXED both. [NIT] reaction/claim rows on a deleted project's post --> ACCEPTED (plan).

#### Iteration 6
- Round 6: no blocker. [WARNING] unanswered() gate and the after-read gates had no test reaching them --> FIXED: direct and mid-read tests, each failing without its gate.

#### Iteration 7
- Round 7: no blocker. [WARNING] receipt keep gate untested --> FIXED: damaged and mid-read tests. [NIT] unanswered markers hidden while damaged --> ACCEPTED (plan).

#### Iteration 8
- Round 8: no blocker. [WARNING] the before-read gates (holdstale, undo, receipt) had no test that fails without them --> FIXED after the round: "unknown at entry, repaired mid-read" tests, each verified to fail with only its before-gate removed. NOT re-reviewed (cap reached). [NIT] sweep gate redundant --> ACCEPTED, documented as defensive.

### Final Ledger
| Round | Blockers | Warnings | Outcome |
|---|---|---|---|
| 1 | 0 | 2 | fixed |
| 2 | 0 | 1 | fixed |
| 3 | 0 | 2 | fixed |
| 4 | 0 | 1 | fixed |
| 5 | 0 | 1 | fixed |
| 6 | 0 | 2 | fixed |
| 7 | 0 | 1 | fixed |
| 8 | 0 | 1 | fixed after the round (tests only), not re-reviewed |

Stopped at the fleet's 8-round cap with no blocker ever open; converged: false because round 8 raised a warning (its fix is tests only, each verified to fail without its gate). Windows suites: holdstale, undo-5153, receipt-5153, messages, taskchat.remade-7185, room server suites green except the Windows baselines (messages #4447 hard link, undo copies-are-private), which fail identically on main.
