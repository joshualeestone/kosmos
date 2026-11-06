---
pre_challenge: true
method: challenge-loop
branch: agentname-8109
diff_hash: e5f5131e6265ba762cc944f699de254376d45789a0bd5dc6efa8b5baaed5dd4a
validation: local-node-suites-only (full Mortals validation pending, held by the 0.7.94 cut)
subdir_audit: passed
timestamp: 2026-11-06T15:42:00Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped at the 8-round cap (Splinter's 10-22 usage rule: past 8 only with a BLOCKER). Round 8 found no BLOCKER and two WARNINGs; one was checked and is not real, the other went to follow-up card #8113. Not a user stop.
**Total findings:** counts for rounds 1 to 5 were not kept per finding across my restart; the BLOCKER and WARNINGs that changed the design are listed below. Rounds 6 to 8 are exact.
**Fixed:** every BLOCKER and WARNING through round 7 | **Deferred:** round 8's guide WARNING (#8113) and the NITs below, all in the plan | **Asked:** 0

kosmos#8109: `kosmos agent remove <name>` takes the name `kosmos agent list` prints (a display name such as "Cai") and acts on the one agent it names (folder `cai`). The plan route resolves only with `?resolve=1` (both CLIs send it); the DELETE route never resolves; a name two agents answer to is refused, naming each.

### Per-Iteration Breakdown

#### Iterations 1 to 5
**Reviewer model:** alternated opus and sonnet; the per-round model was not recorded in my handoff, so it is not claimed here.
**Self-generated:** not recorded.
- [BLOCKER] round 3, server.js DELETE route: resolving on DELETE could remove a DIFFERENT agent when the card's agent went away between the question and the removal --> FIXED (DELETE acts on the exact name only), commit 6b92ce4185
- [WARNING] round 4, server.js plan route: the board's own button asking about a stale card could be answered with another agent's plan --> FIXED (resolve only on `?resolve=1`), commit 1b31859141
- [WARNING] rounds 1 to 5, engine/remove.js resolve: removed agents counted as candidates; an unreadable candidate skipped (a two-agent name could look like one); the ambiguity refusal did not say which folder was which --> FIXED in commits 8c1461bed0, 4020a956c7, cd9859001f
- [WARNING] round 5: pre-existing profile-dir false "removed" for a case variant --> filed #8112 (different path, pre-existing)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING (test gap), 2 NITs
**Self-generated:** 0
- [WARNING] no test that a live session with the exact name is not redirected --> FIXED (test added, mutant-checked), commit 6622d00b47
- [NIT] the "resolving stopped" log line is not throttled --> DEFERRED (plan)
- [NIT] an agent token sees sibling display names in the ambiguity refusal --> DEFERRED (already readable via agent list)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 4 NITs
**Self-generated:** 0
- [WARNING] engine/remove.js resolve: candidates came only from folders in the workers folder, while `agent list` prints every card; a connected or session-only agent shown as "Cai" next to folder `cai` shown as "Cai" resolved to `cai` with no refusal --> FIXED (`cardsForResolve` in server.js passes the board's cards; unreadable means nothing resolves), commit 7765ba67e8. Mutants: route passing no cards, engine ignoring cards, null not failing closed; each turned its own test red.
- [NIT] Mac CLI rewrites a tab in a plan `name` --> DEFERRED (plan)
- [NIT] removed list read once per candidate --> DEFERRED (plan)
- [NIT] resolve block placed above the GUARDED docblock --> DEFERRED (cosmetic)
- [NIT] `ambiguousRefusal` echoes the untrimmed name --> DEFERRED (plan)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 3 NITs
**Self-generated:** 1 (the second WARNING cites the round 7 dedupe line)
- [WARNING] the setup guide is a candidate though `agent list` hides it: a guide display name can make a listed name ambiguous (fails closed), or resolve to the guide as a single match (the exact folder name already did that) --> DEFERRED to #8113 at the cap
- [WARNING] engine/remove.js dedupe `dirs.includes(machine)`: a legacy `<name>-discord` session might count twice --> NOT A DEFECT: measured, the snapshot reports sessionName `<name>`, equal to its folder
- [NIT] HEAD takes the resolve path and runs a snapshot --> DEFERRED (harmless)
- [NIT] a null card list gives the old "cannot find" sentence with no reason --> DEFERRED (fails closed, agreed by the reviewer)
- [NIT] `shown` null prints the bare folder --> NO CHANGE (reviewer noted it is fine)

### Validation (honest scope)
Run locally from the worktree on 7765ba67e8: engine/remove.test.js 116/116, server.agent-remove-name-8109.test.js 7/7, cli.agent-remove-7362.test.js 26/26, server.agent-remove-4475.test.js 36/36, server.test.js 368/368. The full kosmos validation on Mortals has NOT run yet: Mortals is held for the 0.7.94 staging cut. It runs before the push that opens the PR.

### Weakest premise
The candidate list is rebuilt from the same two sources `agent list` joins, not read from its response, so a filter added to only one of them later would drift (round 8's guide finding is one such filter already).
