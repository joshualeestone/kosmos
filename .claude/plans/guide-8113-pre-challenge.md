---
pre_challenge: true
method: challenge-loop
branch: guide-8113
diff_hash: 2ce8e9ee98e4ee18963202c989267ba01bffc27f81925e4308548388b7fd5579
validation: local-node-suites-only (full Mortals validation pending, held by the 0.7.94 cut)
subdir_audit: passed
timestamp: 2026-11-06T16:10:56Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4 found only NITs, zero BLOCKER/WARNING/CONVENTION)
**Total findings:** 0 BLOCKERs, 4 WARNINGs, 3 CONVENTIONs, 11 NITs
**Fixed:** 4 WARNINGs fixed or deferred with reasons (3 fixed, 1 deferred), all 3 CONVENTIONs, 6 NITs | **Deferred:** 1 WARNING and 5 NITs, all in the plan | **Asked:** 0

kosmos#8113 (follow-up to #8109, stacked on agentname-8109): `kosmos agent remove <name>` resolves a listed name using only the board's cards, the names `agent list` prints. The setup guide is left off by the list route's own rule (`guideMarkName`), removed agents are left out, and an exact-named agent the list does not show counts as one more match, so it cannot be acted on silently for a name a listed agent answers to.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 0
- [WARNING] server.js cardsForResolve: nothing tested that removed agents stay out on the cards path --> FIXED, route test with a recorded removal; mutant red. Commit 79cee7fac4
- [WARNING] engine/remove.js: the folder scan and exported `resolveName` kept the over-wide candidate set with no production caller --> FIXED, both deleted; resolve needs cards. Commit 79cee7fac4
- [CONVENTION] server.js: guide rule copied --> FIXED, `guideMarkName()`. Commit 79cee7fac4
- [NIT] 'unchecked' guide fallback untested --> not reachable from resolution (survey fails closed first); replaced by an unreadable-removed-list test with a live card. Commit 79cee7fac4
- [NIT] two false docstring sentences --> FIXED. Commit 79cee7fac4

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] server.js cardsForResolve vs the list route's offline builder: a stopped row whose build throws is dropped by the list and kept here --> DEFERRED, documented at cardsForResolve (usually an extra ambiguity refusal; fixing needs one shared roster function)
- [NIT] guide test left its marker file --> FIXED. Commit 0b462a9a27
- [NIT] dry-run restored as hardcoded true --> NO CHANGE
- [NIT] guideMarkName one-poll skew --> NO CHANGE (fails safe)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 2 CONVENTIONs, 2 NITs
**Self-generated:** 1 (the WARNING is in the exact-name shortcut this branch's iteration 1 left as the only non-card path)
- [WARNING] engine/remove.js resolve: a hidden agent's exact name, also answered to by a listed agent, planned the hidden one with no refusal --> FIXED, an exact agent off the cards is one more candidate; engine and route tests on the real guide shape (slugged machine name); mutant red. Commit 51b25207ba
- [CONVENTION] guideMarkName comment false --> FIXED. Commit 51b25207ba
- [CONVENTION] guideMarkName split setupGuideNow from its doc comment --> FIXED (moved). Commit 51b25207ba
- [NIT] cardsForResolve header stale --> FIXED. Commit 51b25207ba
- [NIT] guide test deleted the seed record --> FIXED (snapshot and restore). Commit 51b25207ba

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [NIT] a removed agent's exact name beside a live card shown by it now refuses as ambiguous, not "already removed" --> DEFERRED (fails closed; follow-up noted on #8113)
- [NIT] removed-agent test leaves its record in the sandbox --> DEFERRED
- [NIT] one long docstring sentence --> DEFERRED

### Validation (honest scope)
Local, from the worktree, on 51b25207ba: engine/remove.test.js 116/116, server.agent-remove-name-8109.test.js 11/11, server.agent-remove-4475.test.js 36/36, cli.agent-remove-7362.test.js 26/26, server.guide-hidden-3739.test.js 7/7, server.setup-guide-page-3034.test.js 15/15, server.test.js 368/368. Full kosmos validation on Mortals has not run (held for the 0.7.94 cut).

### Note
Stacked on agentname-8109, so diff_hash is over origin/main...HEAD including #8109's commits. After #8109 rebase-merges and this branch is rebased onto main, recompute diff_hash before the PR; the reviewed code does not change.

### Weakest premise
`cardsForResolve` repeats the list route's two sources rather than calling one shared function, so a filter added to only one of them would drift (iteration 2's dropped-row case is one).
