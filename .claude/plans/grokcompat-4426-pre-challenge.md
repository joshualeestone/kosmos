---
pre_challenge: true
method: challenge-loop
branch: grokcompat-4426
diff_hash: 8c1440496433b19eb773ac45a920c3f0cbb892b1efcafdff915d8e8e1110492c
validation: passed
subdir_audit: passed
timestamp: 2026-09-28T21:57:46Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2 raised no BLOCKER or WARNING)
**Total findings:** 7 (0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs; summed from the lines below)
**Fixed:** 1 WARNING, 3 NITs | **Kept:** 1 WARNING (disclosed on the PR), 2 NITs | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
- [WARNING] A grok agent adopted at board start keeps the env it launched with. KEPT and disclosed: it takes effect at the next launch. A grok relaunch-on-upgrade path is a bigger change than this card.
- [WARNING] Comments said the agent runs on "AGENTS.md and its own hooks only", but a plain CLAUDE.md in its folder still loads. Fixed.
- [NIT] "84" worded as a standing fact: now a snapshot. [NIT] The plan said every agent has its own GROK_HOME. [NIT] The same caveat in create.js. All fixed.
- [NIT] The test regex would count a commented-out -e line, and hooks uses '0' where the others use 'false'. KEPT.
**Self-generated:** 0

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
- [NIT] '0' vs 'false', as above. KEPT: '0' was already in use and measured working.
- Verified: tmux's last -e wins and the compat flags come after PANE_ENV; turnEnv copies into a fresh object.
**Self-generated:** 0

### Final validation (6j)
- First run: 1 red. supervisor.provider-key-inject-3296.test.js pinned the hooks flag as adjacent to env -u. That pin was loosened to "the last compat flag". The file passes 22/22, and a mutant dropping env -u goes red (8 fail).
- Second run: PASSED (stack typescript, 11454 tests, 0 fail).
- Measured with grok 1.0.41: `grok inspect` went from 84 live [claude] entries to 0.
- Mutants on the new tests: the supervisor drops rules (red), the JS list drops mcps (red), the Windows env goes back to hooks-only (red).
