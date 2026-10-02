---
pre_challenge: true
method: challenge-loop
branch: installgroup-4922
diff_hash: fc55aa0fdb7df1f1194ca1befe856c86933661cb6543680eea86f118a9b1e0c0
validation: passed (Mortals, 03:58 CDT, hash fc55aa0fdb7d)
subdir_audit: passed
timestamp: 2026-10-02T09:21:14Z
iterations: 23
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 23 (6 before the rebase onto main, then 17 on the rebased branch)
**Converged:** Yes (post-rebase iteration 17: 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs)
**Total findings (post-rebase, recorded this session):** 3 BLOCKERs, about 40 WARNINGs, 0 CONVENTIONs, many NITs. The 6 pre-rebase iterations converged before #4940, #4938 and #4902 landed; their per-finding detail was recorded before a context compaction and is not reproduced here. The rebase (squash, conflicts in the register loop and the Settings hint) restarted the loop.
**Fixed:** every BLOCKER and every WARNING except those written into the plan as decided | **Deferred (decided, in plan):** see below | **Asked (awaiting user):** 0 (one copy question is commented on the card for Josh; nothing waits on it)

**Validation, stated plainly:** full local validation passed on Mortals for this diff (hash fc55aa0fdb7d, 03:58 CDT). Community test files 375 pass, 0 fail, 2 skipped, run before each commit.

### Per-Iteration Breakdown (models alternate opus and sonnet)

#### Pre-rebase iterations 1-6
Converged at iteration 6. Detail before compaction.

#### Post-rebase iteration 1 - 0 B, 3 W
- [WARNING] per-agent wait after a failed PATCH; 422 too loose; endpoint untested --> FIXED e7465c31e

#### Post-rebase iteration 2 - 0 B, 3 W
- [WARNING] a 429 did not pause the pass; refused field not remembered; waits not keyed --> FIXED d9c8adeba

#### Post-rebase iteration 3 - 0 B, 3 W
- [WARNING] the pass forgot a refused field; 422 named by loc only; per-id wait untested --> FIXED c3adae565

#### Post-rebase iteration 4 - 0 B, 3 W
- [WARNING] a down service retried per agent; any 422 counted as unknown; header contract missing --> FIXED 6a2c5c3e6

#### Post-rebase iteration 5 - 1 B, 2 W
- [BLOCKER] the real service answers an unknown field with 400 unknown_fields, not 422 (read in kosmos-community app/main.py) --> FIXED e5be786e4 (real-shape fake, contract test)

#### Post-rebase iteration 6 - 0 B, 3 W
- [WARNING] no PATCH route (404/405) and an unclearable 401 kept retrying; value refusal shape wrong --> FIXED 7582ec762

#### Post-rebase iteration 7 - 0 B, 4 W
- [WARNING] a removed agent could be grouped (remove is not delete; it keeps its key) --> FIXED 4ed022c08 (fail-closed removed list)
- [WARNING] several failure branches untested; each now has a measured red control --> FIXED 4ed022c08

#### Post-rebase iteration 8 - 0 B, 3 W
- [WARNING] a removed agent registered with the id; the pass stuck on one failing agent; 429 unlogged --> FIXED 3face0376

#### Post-rebase iteration 9 - 0 B, 3 W
- [WARNING] an agent removed after grouping stayed grouped --> FIXED a3967d884 (sends the clear)

#### Post-rebase iteration 10 - 0 B, 2 W
- [WARNING] the removed agent's clear waited for Community on --> FIXED 835ab9645

#### Post-rebase iteration 11 - 0 B, 2 W
- [WARNING] the clear stopped on an unusable id file; a lost id PATCH answer was not counted as grouped --> FIXED 769a83b68 (write-ahead mark)

#### Post-rebase iteration 12 - 0 B, 2 W
- [WARNING] a definite refusal left the may-have-landed mark --> FIXED 28fe2aa93

#### Post-rebase iteration 13 - 1 B, 2 W
- [BLOCKER] deleting a removed agent's leftovers took it off the removed list, so it could be re-grouped --> FIXED 2290dc06e

#### Post-rebase iteration 14 - 0 B, 2 W
- [WARNING] the tombstone missed an agent removed and deleted between two passes --> FIXED bfd4fe550 (folder gone counts as removed, fail-closed)

#### Post-rebase iteration 15 (opus) - 1 B, 1 W
- [BLOCKER] registration lacked the pass's folder rule (a deleted agent's unsent post registered with the id) --> FIXED 692803847 (tested through a _registration seam, control red)
- [WARNING] an unreadable removed list blocked clears for folder-gone agents --> FIXED 692803847 (control red)

#### Post-rebase iteration 16 (sonnet) - 0 B, 1 W
- [WARNING] the industry test's fake treated an install_group-only PATCH as an industry body (400, clobbered industry) --> FIXED 35091ed6d
- [NIT] module header did not list the clear among what runs with the switch off --> FIXED 35091ed6d

#### Post-rebase iteration 17 (opus) - 0 B, 0 W, 2 NITs
**Converged** - no new actionable findings.

### Outstanding questions (ASKED, still unresolved when the run ended)
- none (the first-run Settings copy is commented on the card for Josh; nothing waits on it)

### Decided and recorded in the plan (DEFERRED with reasons)
Public effect shipped as decided in #4370; only while Community is on (turning off does not ungroup); existing users grouped on first sweep; the Settings line states the service's rule; clears share the pass's pauses; an unresolvable folder counts as gone; a lost registration can leave a grouped agent with no key; deleting leftovers keeps the community key (filed kosmos#4994).

### NITs (iteration 17, kept)
- engine/communitysend.js agentCall budget comment says up to 3 registrations; the unknown-field fallback can make a 4th, still bounded by request()'s deadline check.
- the retry-log mark is keyed by the id, so after a failed clear then a restore one failure line can go unlogged (pause and retry still happen).

### Strengths (across iterations)
- Answer shapes match the real service source (400 unknown_fields, 422 value errors, 204 on PATCH, null clears).
- One removed/folder-gone rule at registration and in the pass, fail-closed.
- Every failure branch has a test with a measured red control.
