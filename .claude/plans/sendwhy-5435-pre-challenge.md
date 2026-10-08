---
pre_challenge: true
method: challenge-loop
branch: sendwhy-5435
diff_hash: 3116af0009fbb9d40e3d39068b33551bfceee00ea89b2ab318bbc5841300c40b
validation: passed (Mortals full suite at a80d942f2, hash 6f2c04e2dde1); a wording-only change followed (below), its 347 tests pass and the PR CI runs the full suite on it
subdir_audit: passed
timestamp: 2026-10-07T16:44:02Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10 (blind reviewers alternated between Opus and Sonnet; each reviewed only this branch's own change)
**Converged:** Yes (iteration 10, Sonnet: NITs only; nothing sent differs from the base, confirmed in iterations 8 to 10)
**Total findings:** 3 BLOCKERs (all in a design later reverted), 22 WARNINGs, 1 CONVENTION, NITs
**Fixed:** 23 | **Deferred:** 3 (filed as #5460) | **Asked (awaiting user):** 0

Local evidence at ffc946cc2: every community test, the CLI and route tests, and the repo guards, 946/946.
Every guard added in the loop has a mutation that turns it red (listed per review in the plan).

### Per-Iteration Breakdown

- [WARNING] Iterations 1-2: wrong reasons for an unreadable switch, an unwritable start and a bad address; post words
  promising a post goes later; status contradicting the command one command later. FIXED.
- [WARNING] Iteration 3: the sweep ended the period for an unreadable switch, losing posts; read, vote and follow said
  "switched off". The words were FIXED; the sweep change made then was REVERTED in iteration 5.
- [WARNING] Iteration 4: keeping the period sent a post made while the page showed OFF. A dark-window fence was added.
- [BLOCKER] Iteration 5: the dark window leaked three ways. REVERTED with the iteration 3 sweep change; the sweep ends
  the period as on main. Recorded in the plan with reasons.
- [WARNING] Iteration 6: status words for a torn switch and a bad address; a race before the sweep. Words FIXED; the
  race fix (ending the period at willSend) REVERTED in iteration 7.
- [WARNING] Iteration 7: ending the period at willSend let any transient read error end it for every agent. REVERTED;
  a "switch" reason with its own words ADDED; what is left FILED as #5460 (deferred: status after a repair, any read
  error counting as a tear, the window before the sweep).
- [WARNING] Iteration 8: a refused agent's comment read differently in status; the held-comment guard unpinned. FIXED.
- [WARNING] Iteration 9: a stale comment, "post" for comments, notOnWords read twice and unpinned at three callers.
  FIXED.
- [NIT] Iteration 10: two wording NITs (agentCall's docblock; a marked comment's status for the switch case). Left.

### After convergence (disclosed)

Two merges of main landed after the loop converged; neither changed this branch's own lines:
- c584816f8 merged main after #5431 merged (a conflict in tools/windows-tests.js resolved as a union).
- a80d942f2 merged main to take #5474, the fix for the known cli.sandbox-4636:159 red. The run before it failed only on
  that test, which Splinter ruled the change does not chase; the re-run after the merge passed.
No web/ file changes, so no browser check applies.
- After the PR opened, Mona's design review changed two sentences and the matching CLI fallback (wording only, no
  logic): post.off now ends "before you see where it stands with:", and the comment records/switch sentences say
  "this one" for "this copy". The tests that pin those strings were updated with them.
