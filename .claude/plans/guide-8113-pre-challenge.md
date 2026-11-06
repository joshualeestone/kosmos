---
pre_challenge: true
method: challenge-loop
branch: guide-8113
diff_hash: acab32b634f187b8334d528da0195d2514af491a125f9ecbc8eb829274d3704e
validation: local-node-suites-only (full Mortals validation pending, held by the 0.7.94 cut)
subdir_audit: passed
timestamp: 2026-11-06T16:26:48Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes, on the code iteration 4 reviewed (only NITs). A follow-up committed after that was reviewed in iteration 5, found unsafe, and reverted, so the code is byte-identical to 276090ee2e, the commit iteration 4 reviewed; only the plan differs.
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
- [NIT] a removed agent's exact name beside a live card shown by it now refuses as ambiguous, not "already removed" --> tried a fix after convergence (9a2ffa7174), see iteration 5; reverted; DECIDED to keep the refusal (fails closed)
- [NIT] removed-agent test leaves its record in the sandbox --> DEFERRED
- [NIT] one long docstring sentence --> DEFERRED

#### Iteration 5 (the post-convergence follow-up only)
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 2 NITs, all on 9a2ffa7174
**Self-generated:** 4 (all on this loop's own follow-up commit)
- [WARNING] engine/remove.js: the removed-exact early return answered "already removed" about a hidden folder while a live card the person copied answers to the name --> FIXED by reverting 9a2ffa7174 (commit 3760508f76)
- [CONVENTION] resolve docstring and the guideMarkName comment false after it --> resolved by the revert (both true again)
- [NIT] the try/catch did not give the fail-closed behaviour its comment claimed --> resolved by the revert
- [NIT] the test leaked a second sandbox agent and had no engine twin --> resolved by the revert

### Validation (honest scope)
Local, from the worktree, on 51b25207ba (the same code; engine 116/116 and route 11/11 re-run on 2ccae18137 after the revert): engine/remove.test.js 116/116, server.agent-remove-name-8109.test.js 11/11, server.agent-remove-4475.test.js 36/36, cli.agent-remove-7362.test.js 26/26, server.guide-hidden-3739.test.js 7/7, server.setup-guide-page-3034.test.js 15/15, server.test.js 368/368. Full kosmos validation on Mortals has not run (held for the 0.7.94 cut).

### Note
Stacked on agentname-8109, so diff_hash is over origin/main...HEAD including #8109's commits. After #8109 rebase-merges and this branch is rebased onto main, recompute diff_hash before the PR; the reviewed code does not change.

### Weakest premise
`cardsForResolve` repeats the list route's two sources rather than calling one shared function, so a filter added to only one of them would drift (iteration 2's dropped-row case is one).
