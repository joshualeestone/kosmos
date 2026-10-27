---
pre_challenge: true
method: challenge-loop
branch: win-attach-cost-7232
diff_hash: 506ddd2902d4e2e1dd8146e928796a9621aef5776ba8e8d1f87a62dfa5814f92
validation: windows: replyfile.win32-7221 94/94 (+1 CI-only skip), reachable 8/8, windows-tests-1777 23/23, separator-guard 4/4, coupling 8/8; real dead-drive check pending Josh
subdir_audit: passed
timestamp: 2026-10-27T20:58:32Z
iterations: 5
converged: true
---

# Pre-PR review proof: win-attach-cost-7232

**Iterations:** 5
**Converged:** Yes. The last round found no BLOCKER; anything it raised is recorded below.
**Per-round record:** .claude/plans/win-attach-cost-7232.md

## Rounds

#### Iteration 1
- Round 1: [BLOCKER] mis-decoded share names let a nested file through --> FIXED (UTF-8, malformed shares unknown). [BLOCKER] keptRoots skipped an agent whose share is unknown --> FIXED. [WARNING] table kept for ever on failed refresh --> FIXED (120 s drop). [WARNING] absent-then-subst letter --> FIXED (walked as main). [WARNING] this-computer names --> FIXED. [NIT] one re-learn per refresh --> FIXED.

#### Iteration 2
- Round 2: no blocker. [WARNING] two shares of one server, same folder --> FIXED (spelling skip only for a local file). [WARNING] remembered unavailable mapping read absent --> FIXED. [NIT] x3 --> FIXED.

#### Iteration 3
- Round 3: [BLOCKER] stale share on a now-local letter --> FIXED (share overrides only types 0/1/4). [WARNING] redirector failing refused board-wide --> FIXED (!ENUM_FAILED -> unknown; exposed the $e.Count() bug). [WARNING] local link onto a dead drive stalled keptRoots --> FIXED. [NIT] blocking re-learn --> FIXED (background).

#### Iteration 4
- Round 4: no blocker, no fail-open. [WARNING] drive mapped below a share refused board-wide --> FIXED. [NIT] hex host names --> FIXED. [NIT] known() spent a re-learn --> FIXED.

#### Iteration 5
- Round 5: no blocker, no warning. [NIT] device spellings as shares --> FIXED. [NIT] wording --> FIXED.

### Final Ledger
| Round | Blockers | Warnings | Outcome |
|---|---|---|---|
| 1 | 2 | 4 | all fixed |
| 2 | 0 | 2 | all fixed |
| 3 | 1 | 2 | all fixed |
| 4 | 0 | 1 | fixed |
| 5 | 0 | 0 | converged |

Every fix carries a test verified to fail without it. Windows: replyfile.win32-7221 94 pass / 1 skipped (Windows-CI-only arm), engine.reachable 8/8, windows-tests-1777 23/23, coupling audit 8/8; scale: 200 projects, one on a dead Z:, local attach ~58 ms, Z: untouched. NOT YET RUN: the real dead mapped drive (needs a sign-out on the Windows box, which restarts its fleet; waiting on Josh's go). A live mapping's share read (Item() on EnumNetworkDrives) is verified only through the same WshCollection type (printers), since this box cannot make a mapping without admin.
