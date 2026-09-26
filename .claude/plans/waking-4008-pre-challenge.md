---
pre_challenge: true
method: challenge-loop
branch: waking-4008
diff_hash: f09828b2bb56aaacbf84ab24abd7be5e08c2caa3436fd00ef241da875da24e45
validation: passed
timestamp: 2026-09-26T18:22:42Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (opus, sonnet, opus, sonnet). **Converged:** Yes (round 4: NO NEW FINDINGS at any level).
Decisions and rejected alternatives: .claude/plans/waking-4008.md ("Review rounds 1 to 3").

### Per-Iteration Breakdown

#### Iteration 1 (opus)
- [BLOCKER] Runs on was painted only on opening the agent's page, so the switch never showed --> FIXED (413cde1)
- [WARNING] the switched-model record could pin a wrong model --> FIXED (413cde1)
- [WARNING] the model picker contradicted Runs on --> FIXED (413cde1)
- [WARNING] the #2518 surface gate failed --> FIXED (413cde1, trailers)
- [WARNING] the instructions flow's "Waking" line had no loader --> FIXED (413cde1)
- [CONVENTION] README row and comments described the old lines --> FIXED (413cde1)
- [NIT] a superseded Start could spin forever; Done focused twice --> FIXED (413cde1)

#### Iteration 2 (sonnet)
- [WARNING] the fallback finish had no check --> FIXED (8e98562)
- [WARNING] a superseded Start had no check --> FIXED (8e98562, render-start-agent-3410 Part 9)
- [CONVENTION] the "switch is live" gate was derived twice --> FIXED (8e98562, switchedModelFor)

#### Iteration 3 (opus)
- [WARNING] the provider switch left Runs on on the old model --> FIXED (aca2e04)
- [NIT] Start and Restart dropped a record that was still true --> FIXED (aca2e04)

#### Iteration 4 (sonnet)
No issues found.

### Validation
- Full suite (tools/run-tests.sh, DEVELOPER_DIR=CommandLineTools) on aca2e04: 9909 pass, 0 fail,
  SUITE_EXIT=0; the #2518 surface gate run directly: exit 0.
- Browser checks headless: render-autohello-switch-2716 (25), render-model-restart-interstitial,
  render-start-agent-3410, render-restart-kloader-2831, render-autohello-2686: all pass; every #4008 arm
  measured red without its fix.
