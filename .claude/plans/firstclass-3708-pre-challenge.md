---
pre_challenge: true
method: challenge-loop
branch: firstclass-3708
diff_hash: 0887f57859f6baa46ab780e92e7ce9628e13c12775430b0bcf237c37ab262189
validation: passed on content, not in one run (see "Validation" below; three full runs of this exact diff, every failure in a file this branch does not touch and green alone)
subdir_audit: passed
timestamp: 2026-09-25T10:24:30Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (reviewer models: opus, sonnet)
**Converged:** Yes, at iteration 2 on 88df00fb (no findings; the two commits after it are empty trailer commits, so the diff is unchanged)
**Total findings:** 1 BLOCKER, 2 WARNINGs, 2 NITs (+1 suite-found defect, the same as the BLOCKER)
**Fixed:** all but one NIT | **Deferred:** 1 NIT | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
- [BLOCKER] web/index.html: grok.com's two mark paths carried `id="mark"`, a duplicate id (web.unique-ids.test.js; also in every providerMarkNode clone) --> FIXED (3449dc0d, found by the suite first; 88df00fb for the docs SVG)
- [WARNING] "xAI · works today" was untrue on a fresh computer: Connect stops at "not installed" because Kosmos does not install Grok's tool --> FIXED (88df00fb: "xAI · subscription or API key today"; putting the old text back reds the #3386 check and the model test)
- [WARNING] five stale descriptions of the letter chip or the old banner position --> FIXED (88df00fb)
- [NIT] subtitles used a literal middle dot while Claude's and GPT's use `&middot;` --> FIXED (88df00fb)
- [NIT] the "#541 ship-day" comment has no element under it --> DEFERRED (orphaned before this branch; moving it means guessing where that line lives)
- Measured clean: the #conn move on every view and agent-page section at three sizes; the consolidated layout pixel-identical to main.

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0
- Confirmed the subtitle against the Connect code path, perturbed it back and saw the check red, confirmed the reason-grep counts by hand, and swept the repo for stale chip or banner references (none current-state).

### Validation
Three full runs of this exact diff (hash 0887f578), because the Mac was loaded by other agents' suites (load 20 to 30):
- 88df00fb: 9190 tests, 0 failed; the #2518 surface gate failed on three checks whose tokens share a changed line. Each check was run and passes; per-check trailers added (66ab080a, with the `.js` basename the gate needs after a first attempt without it at ef16856e). The gate alone on 66ab080a: rc=0.
- 66ab080a: 9190 tests, 1 failed: `#1760 scrub ... without throwing` (engine/feedbacksend.test.js, a 3.9s timing budget at load 8.6). Alone: 295ms and 278ms, green twice.
- 66ab080a: 9190 tests, 2 failed: the same #1760 timing test, and `#1618 two callers ... verify each door ONCE` (server.doorflight-1618.test.js). Alone: 52/52 and 4/4 green.
Neither failing file is in this branch's diff. CI on GitHub's runner is the merge gate.

### Process
Reviewers ran blind, forbidden to edit the worktree while a suite ran, mutation runs only in their own mktemp copies; orphans after cleanup: 0, 0.
