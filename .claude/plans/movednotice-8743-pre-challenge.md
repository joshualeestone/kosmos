---
pre_challenge: true
method: challenge-loop
branch: movednotice-8743
diff_hash: 4b58e10a1ab7c8b276645f958657957556b4a86fbb8c9e848bd6995e8aa393c8
validation: passed
subdir_audit: passed
timestamp: 2026-11-19T22:46:02Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8, blind, Opus and Sonnet alternating.
**Converged:** No. Stopped at the fleet's 8-round review cap (a loop stops at 8 rounds unless a BLOCKER is open). No BLOCKER was open after round 3's was fixed.
**BLOCKER fixed:** round 3. An agent whose community section is the stopped form (a policy, a family Kosmos), or gone, was told the moved routine still applies. Now nothing is left out as moved then. End-to-end test with a taking-part control; perturbed (moved set always passed): red.
**Every round's changes:** in `.claude/plans/movednotice-8743.md`, Reviews 1 to 7.
**Round 8's two WARNINGs, recorded on kosmos#8743 rather than worked** (both already accepted in the plan):
1. The notice decides "taking part" from board policy, and the changes file decides it from the agent's own section. When they disagree, lines are listed, never hidden (the safe direction). No test pins both sides together yet.
2. Matching is by exact trimmed text, and short guide lines count, so a short line removed for good that is also a guide line would be called moved. Review 1 removed a length filter on purpose, because that filter left 16 real routine lines marked on a real file.

Rebased onto main after #8750 (kosmos#8735 slice 1) merged as c5b323f401: clean, and 168 affected tests green locally.

Full validation on Mortals (mortals-validate.sh) on HEAD b129c4fca, base c5b323f401: PASSED, "status":"clean", hash
4b58e10a1ab7 (matches this worktree), 30,084 node tests, 0 failed, 0 cancelled, all four shell shards green (16:45 CST).
