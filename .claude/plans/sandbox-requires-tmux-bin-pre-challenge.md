---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: sandbox-requires-tmux-bin
diff_hash: 81af983b23c976712348452464bf5f52d0ae863d7e1f95850f6fc32823ed19d9
timestamp: 2026-08-31T17:16:07Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

Single-pass self review. `explicit_override` set by me and named rather than buried: no challenge-loop skill, no review agent.

🛑 **[BLOCKER-CLASS, FOR THE REVIEWER, NOT A DEFECT]** This touches **release tooling**: `tools/test-install.sh` and `tools/build-kosmos-bundle.sh`. It should NOT be batch-merged with low-risk items. Three people refused to self-merge fleet-wide changes today and each was right; this is the same shape.

[STRENGTH] The mechanism was PLANTED, not read: DRY_RUN with no TMUX_BIN gave an ALLOWED board whose roster resolved to the real `tmux`, and that binary sees 18 panes. That reproduces the card's "18 of 18" exactly.

[STRENGTH] All five guard arms measured, including the two that must NOT change: nothing-set (the real product) still ALLOWS, and `HALF_SANDBOX_OK` still ALLOWS. A fix that broke either would be worse than the defect.

[STRENGTH] The alternative design was rejected on measurement rather than taste. Emptying the roster under DRY_RUN is smaller and breaks 7 files that legitimately expect their stub's panes. Counted before choosing.

[STRENGTH] Six of the ten test files already wrote their own tmux stub onto PATH. They name **that stub**, so their fixtures are unchanged. My first pass pointed them all at `fake-tmux.sh` and broke six fixtures; naming each file's own stub is what fixed it.

[WARNING] **My file classifier was wrong in BOTH directions** and the real population came from running the suite, not from the classifier. It missed both `gate-log` files (my re-measurement silently dropped the `require('./server')` form my first pass had) and falsely included `engine/projects` (matched a string where the test *writes* a fixture named `server.js`). **The card's figure and my own 17 / 11 / 9 were all wrong.**

[WARNING] **A green node count hid a red suite.** Three runs showed 3,254 pass / 0 fail while `run-tests.sh` exited 1: a SHELL suite, `build-smoke-sandbox`, had 5 failures invisible in the node totals. **Only the exit code caught it.** Anyone verifying this must read the exit status, not the test counts.

[NIT] The refusal sentence grew to name both hazards, which broke an assertion pinning the old phrase. Rewritten as two property assertions so the next rewording does not have to come back.

[CONVENTION] No em dashes added, checked before writing.


[STRENGTH, ADDED AFTER A SELF-AUDIT] **I found a real defect in this branch by checking a surface the suite does not cover.** Browser checks are not in `run-tests.sh`, so exit 0 said nothing about them. The `render-create-made` board in `tools/browser-checks.sh` set four dirs plus DRY_RUN and no TMUX_BIN: measured both ways on the same env, current main ALLOWS it and this branch REFUSED it. It would have failed to boot. Fixed. Every other boot site was already covered, and that file's header records three release cuts taken down by its assertions.

### Final Ledger

`tools/run-tests.sh`: **exit 0**, 3,260 tests, 3,260 pass, 0 fail, zero shell-suite failures.
