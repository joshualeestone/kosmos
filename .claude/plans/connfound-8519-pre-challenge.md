---
pre_challenge: true
method: challenge-loop
branch: connfound-8519
diff_hash: a5f5e7d14774c97ca86e99f079b9fbb0c92ce17ddb5dfa9102d88306b1324eff
validation: passed
subdir_audit: passed
timestamp: 2026-11-14T16:58:09Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes (iteration 6 raised no BLOCKER and the reviewer would merge; its two WARNINGs are fixed and pinned)
**Fixed:** every BLOCKER and WARNING of iterations 1 to 6 | **Asked:** 0

Iteration 3 found that the premise of the automatic path (sorting free error text) was wrong, so it was redesigned,
not narrowed again: the hook now records only an unknown-tool refusal that names the called action. The redesign and
the build-vs-design differences are posted on kosmos#8519.

Validation: `bash tools/run-tests.sh` on this branch.
- Run 1 (10:21 CST): red, 6 of 29089, all this branch's own guard misses, fixed in 2f6088ec9d.
- Run 2 (10:47 CST): 28564 pass, 1 fail: tools.shell-shard-4317 (#6791), which runs run-tests.sh, which ran the #2518
  surface gate. The gate refused render-cloud-signin-4903.js on the token 'asSentence', which this branch now uses
  inside the new Connections section (the agents' note). That check's sign-in screen is untouched, so the per-check
  trailer is on the commit that adds this proof. With it, the gate passes and that file passes alone (re-run after
  this commit). The same file passed 24 of 24 on origin/main, so the only cause was the gate.
- Also run: the card's own tests (engine, server, both CLIs, the guide), the touched pins, render-conn-found-8519.js
  (52 of 52), and the #1720 and #2518 gates.

### Per-Iteration Breakdown
Recorded in full in .claude/plans/connfound-8519-pre-challenge.md's sibling, .claude/plans/connfound-8519.md (Iterations 1 to 6, each
finding with how it was fixed or why it was left).
