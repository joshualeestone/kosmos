---
pre_challenge: true
method: challenge-loop
branch: tasks-built-3951
diff_hash: b45e736206dc16d9b487a6e4c20297dabd0e8b29765943874f44ea0fdd6dbdd1
validation: passed
subdir_audit: passed
timestamp: 2026-09-26T21:40:39Z
iterations: 16
converged: true
---

# Challenge loop proof: tasks-built-3951 (#3951, Built but waiting)

Sixteen blind reviews, alternating Opus and Sonnet, ledger in `.claude/plans/tasks-built-3951-20260926T1335.md`.
Validation (full suite, browser checks, surface gate) rc=0 and subdir audit rc=0 at 4b68b529f.

## Per-iteration findings
- Iteration 1 (Opus): 1 NEW. [WARNING] a part put back on a built task kept the mark. FIXED.
- Iteration 2 (Sonnet): 2 NEW. [WARNING] stale page comments; [WARNING] "Not built yet" wording on a closed task. FIXED.
- Iteration 3 (Opus): 1 NEW. [WARNING] the Assigner ignored the mark. FIXED (pick skips, hasOpenWork frees).
- Iteration 4 (Sonnet): 1 NEW. [WARNING] a built task freed every holder. FIXED (frees the marker, or all for the person).
- Iteration 5 (Opus): 1 NEW. [WARNING] giving an open part kept the mark. FIXED.
- Iteration 6 (Sonnet): 1 NEW. [CONVENTION] CLAUDE.md row incomplete. FIXED. One WARNING deduplicated (decided in 5).
- Iteration 7 (Opus): 1 NEW. [WARNING] a process could take over the person's mark. FIXED (screen only).
- Iteration 8 (Sonnet): 2 NEW. [WARNING] cap env 0 became 60; [WARNING] an unnamed mark. FIXED / DECIDED.
- Iteration 9 (Opus): 1 NEW. [WARNING] only the last marker was kept. FIXED (builtWho).
- Iteration 10 (Sonnet): 1 NEW. [WARNING] route comment wrong about clearing a closed task. FIXED.
- Iteration 11 (Opus): 2 NEW. [BLOCKER] surface gate token msg; [WARNING] an unnamed caller had more power. FIXED.
- Iteration 12 (Sonnet): 1 NEW. [BLOCKER] self-inflicted id rename broke the button. FIXED, browser check re-run.
- Iteration 13 (Opus): 1 NEW. [WARNING] the pane fallback could not name a Mac agent. FIXED (messages.resolveSender).
- Iteration 14 (Sonnet): 0 NEW code findings. [NIT] agoWords twice, left. Converged; then rebased onto main.
- Iteration 15 (Opus, rebased): 1 NEW. [WARNING] a repeat mark rewrote the store. FIXED (NO_WRITE sentinel).
- Iteration 16 (Sonnet): 0 NEW. [NIT] x3, left. CONVERGED.

## Deferred / decided (reasons in the plan)
- The person's mark is set only from the screen; there is no screen control to MARK built (agents mark).
- An unidentified process is held to the board token, as the message route is.
- Built marks share the runaway breaker (#4019); AGENT_WORKFORCE_BUILT_MARK_CAP, 0 = off.
