---
pre_challenge: true
method: challenge-loop
branch: iosswitch-8626
diff_hash: 3fa2668a0846e1cc06dbc02dd8a12d242837f01174e7d216c5a289c4510c1d90
validation: full local validation PASSED (validation-log hash 3fa2668a0846, node 28918 pass / 0 fail, shell shards status 0) on 2ce63a82bd; ios/LogicTests/run-agentinfo.sh 174/174; server.ios-routes-6838.test.js 5/5; simulator build (xcodebuild -target Kosmos -sdk iphonesimulator27.0) succeeded
subdir_audit: not run (no CLAUDE.md in the diff)
timestamp: 2026-11-17T15:04:40Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7, blind, alternating sonnet and opus, every round on the whole branch.
**Converged:** Yes, at iteration 7 (no BLOCKER or SHOULD-FIX; three NITs recorded below).
**Fixed:** every SHOULD-FIX from rounds 1 to 6 | **Residuals carried to the card:** no wake hello after a switch; Qwen can be offered to a Windows computer (the engine refuses in its own words).

### Per-Iteration Breakdown

#### Iteration 1 (sonnet): 6 SHOULD-FIX, 4 NITs, all fixed in 026200892d
- ios-routes-6838 would go red on the OpenAI models request: SITES entry added
- result line wiped by onChange after a success; picked sent true for the page's own default; badge filter applied to Claude/OpenAI (the board keeps those rows); false empty-state and Meta Muse sentences; stale picks after a reload
#### Iteration 2 (opus): 4 SHOULD-FIX, fixed in f55d42967c
- another account's models shown while a new account's load; rows that read alike; the empty line spoke for the computer; the within-family note claimed the conversation is kept (board: it ends, as on any restart)
#### Iteration 3 (sonnet): 3 SHOULD-FIX, fixed in 7c7d6a2603
- "nothing was switched" on no answer; Runs on lagging the restart; the dialog's state after a reload
#### Iteration 4 (opus): 1 SHOULD-FIX, fixed in f9242f83d3
- "Switching" stayed under a refusal while the page re-read
#### Iteration 5 (sonnet): 1 SHOULD-FIX, fixed in ce00101369
- a switch back before status caught up left a false "Moving to" note
#### Iteration 6 (opus): 1 SHOULD-FIX, fixed in 2ce63a82bd
- a switch saved but not restarted showed "Moving to"
#### Iteration 7 (sonnet): CONVERGED
- NITs only: the moving note waits for status; a saved-not-started line stays until the next pick; a slow restart gives the honest cannot-tell line
