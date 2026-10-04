---
pre_challenge: true
method: challenge-loop
branch: joincode-4794
diff_hash: 01e10ae84ca4fa8906afca3edbef3d0c6b0cac2319a8b8c6dd086992d075a558
validation: passed (Mortals, mortals-validate at 48a823a65 = this branch merged with origin/main, hash 01e10ae84ca4, EXIT=0 12:11; browser checks this branch changes run at the exact head on Mortals 11:50: render-connect-sheet-4637 all passed, mobile-shots 20 shots 0 overflow 0 errors; coarse and surface browser-check gates rc 0 under bash -c, the surface gate with three per-check overrides in commit trailers)
subdir_audit: passed (no subdirectory CLAUDE.md in the diff)
timestamp: 2026-10-04T17:13:11Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 blind reviewers alternating Opus and Sonnet (rounds 5 and 7 Opus, 6 and 8 Sonnet), each checking fixtures against the tunnel source (kosmos-relay d1216d79, pairing.rs).
**Converged:** Yes, round 8: 0 BLOCKER, 0 WARNING.

### Per-Iteration Breakdown (from .claude/plans/joincode-4794.md, where each round is recorded in full)
#### Iterations 1-4: findings addressed in f3455ef77, ab29230b7, 8125f0ff8, 03b62472c (round 4: the pairing code is "ddd ddd", not six digits)
#### Iteration 5 (Opus): 3 WARNING, 1 NIT fixed (email-code fixtures reverted; a page loaded after the Allow reads the pairing once; the real ran-out state)
#### Iteration 6 (Sonnet): 0 BLOCKER, 5 WARNING fixed (one root cause: after-Allow endings were forced through the poll gate; live vs endings split)
#### Iteration 7 (Opus): 1 BLOCKER, 1 WARNING, 3 NIT fixed (the past-10-minutes arm, Forget/Off reset the pairing, fixtures in the tunnel's shape)
#### Iteration 8 (Sonnet): 0 BLOCKER, 0 WARNING --> CONVERGED (NITs left, listed in the plan)

### Disclosed
- One commit came AFTER round 8: 7410363ea ("the plus-join shot fakes the devices answer too"), a fixture change in docs/browser-checks/mobile-shots.js only. No reviewer saw it; mobile-shots passed at this exact head (above).
- The branch was 229 commits behind main; merged (48a823a65), not rebased. The merge was clean and the validation above is of the merged head.

### Weakest premise
That the code the page shows on the allowing computer is the code the tunnel will accept at Allow (the tunnel recomputes at Allow and refuses a mismatch; the page words that refusal).
