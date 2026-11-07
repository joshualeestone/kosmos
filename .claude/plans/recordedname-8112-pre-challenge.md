---
pre_challenge: true
method: challenge-loop
branch: recordedname-8112
diff_hash: 6c1f1645850cc3c10633e3f72ea40b0911aa51c253a87e84e139c5029a62d3dd
validation: local (engine/remove.test.js 129/129, the 13 #8112 tests also alone; 233 files touching remove, workerDir, profiles or discover: 5024 tests, 0 fail); the full suite runs in PR CI
subdir_audit: passed
timestamp: 2026-11-07T07:02:22Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7 (one blind general-purpose reviewer at a time)
**Converged:** Yes. Round 7 raised no BLOCKER and no WARNING; its two comment NITs were fixed, one performance NIT kept.
**Asked (awaiting user):** 0

### Per-Iteration Breakdown (detail in .claude/plans/recordedname-8112.md)

#### Iteration 1
- [BLOCKER] the first fix made a register-only agent (recorded folder, no job, no session) unremovable --> FIXED (displayName rule)
- [WARNING] fixtures always had a job --> FIXED; [WARNING] forgetCodexFolder ran on a variant --> FIXED; [NIT] message --> FIXED
- Rejected the suggested "key form proves it": register-only accepts uppercase names (measured)

#### Iteration 2
- [WARNING] Windows schtasks lookup ignores case --> FILED #8177 (predates this, every agent, untestable here)
- [WARNING] a rename stranded a register-only agent --> FIXED (connectedAs)
- [NIT] Codex-skip test --> its test passed with the guard deleted, so removed; gap stated

#### Iteration 3
- [WARNING] failed connect left connectedAs --> FIXED (rollback restores it); [WARNING] no test through discover --> FIXED
- [NIT] Undo left connectedAs --> FIXED; found a fixture key collision (the lowercasing itself), renamed

#### Iteration 4
- [BLOCKER] every agent connected before this change failed its own name (displayName from instructions) --> FIXED (old-profile fallback)
- [WARNING] a skipped Codex step reported success --> FIXED (step left out)

#### Iteration 5
- [BLOCKER] old full connect shown as its own name capitalised ("April") --> FIXED (the job decides a shared key)
- [WARNING] old register-only "orch.main" lent "orchmain" --> FIXED (safeKey comparison)
- Measured false: "the job is gone before the message" (removal disables, touches no files)

#### Iteration 6
- No BLOCKER. Full truth table; two cells wrong, both a RENAMED OLD register-only profile --> KEPT as the stated limit
  (byte-identical to a profile typed that way; new profiles carry connectedAs)
- [NIT] old-profile test passed through the key-form arm --> FIXED

#### Iteration 7
- No BLOCKER, no WARNING. No regression for agents without a recorded folder; tests order-independent.
- [NIT] stale header comment --> FIXED; [NIT] stale inline comment --> FIXED; [NIT] up to three schtasks queries in resolve on Windows --> KEPT (time only)

### Mutants run by the author (each fails its test)
displayName check removed; job check removed; recorded never proves; connectedAs ignored; register-only write drops
connectedAs; Undo keeps connectedAs; rollback drops connectedAs; old fallback needs displayName only; no case-variant
refusal; shared key always refuses; displayName equality ignored.
