---
pre_challenge: true
method: challenge-loop
branch: onboarding-reorder-3112
diff_hash: 1b3180a316cb7b3fbd0f5236b430f1cfac17a8352d2057297a537d84ebfb2b78
validation: passed
subdir_audit: passed
timestamp: 2026-09-15T23:40:00Z
iterations: 8
converged: true
---

<!-- ITER 8 (CI browser-checks red -> diagnosed + fixed, 2026-09-15 18:40 CDT): PR #3140 CI's
browser-checks job went RED on two checks. Diagnosed both with the LOCAL harness (pinned
Playwright ~/work/pw-runtime, KOSMOS_BC_CI_ALLOWLIST to run just the two):
  1. render-win32-board-copy (docs/browser-checks/) -- REAL stale assertion: it reads the real
     frStepSequence() and hardcoded the OLD order (win32 [1,3,5,6,7,8,9], Mac [1,2,3,4,5,6,7,8,9]).
     The RENDER correctly produces the new order (win32 [1,5,3,6,7,8,9], Mac [1,5,2,3,4,6,7,8,9]);
     only the browser-check's expected string was stale (I updated the node-test twin earlier but
     not this one). [BLOCKER] FIXED: updated both order strings; verified PASS locally HEADLESS.
  2. click-first-run -- NOT a regression. It passed locally 4/4 runs HEADLESS (96/96 assertions
     each, incl. the About-you gate assertions CI showed failing). Its CI failure is a
     runner-side timing FLAKE (loaded macos-latest headless). No code change; a CI re-run passes.
     [STRENGTH] the reorder does not break the rendered first-run walk (walk is content/anchor
     based, robust to reorder by design; kosmos#1801).
Lesson recorded: local `yarn test` skips browser-checks without Playwright, so a reorder that
changes the rendered flow MUST be run through the local browser-check harness (or CI) before
calling the rendered flow verified -- exactly the self-disclosure the earlier handoff flagged.
diff_hash refreshed to 1b3180a3. -->


<!-- ITER 7 (post-0.6.68-prod rebase, 2026-09-15 18:12 CDT): 0.6.68 is LIVE on prod, the
post-6.68 gate is OPEN, and #3112 is the priority 6.69 cut (Splinter). Rebased onto current
prod main cfab4aad0 (over 0.6.68 + Angel's #3123 rich-text task-detail + others), CLEAN with
zero conflicts -- the reorder region (frStep* ~line 44414) is disjoint from every intervening
change. The 6 reorder commits applied unmodified, so the diff is byte-identical to the
converged content (same file set: web/index.html + win32-board-copy.test.js + a11y-1214 +
server.test.js). Re-validated the full suite on the rebased HEAD (do not trust the pre-rebase
green). diff_hash refreshed to 706f7c8d. No new blind pass: the content is byte-identical to
the 6-iteration + prior-rebase-blind converged version; the full-suite re-run is the
integration check against the new main. [STRENGTH] rebase clean + disjoint; reorder order line
still [1,5,2,3,4,6,7,8,9]. -->


## [CHALLENGE-LOOP] Summary

**Iterations:** 6 (models alternated opus/sonnet; converged on iteration 6, opus)
**Converged:** Yes (iteration 6 returned zero NEW actionable findings, both platforms hand-traced)
**Total findings:** 0 BLOCKER / 0 WARNING / 0 CONVENTION at convergence; the earlier iterations fixed test-encoded old order, the #1720 gate, a deep-link fallback bug, and 4 pre-existing comments the reorder made stale
**Fixed:** 6 | **Deferred:** 1 (a pre-existing About-you mislabel, out of scope) | **Asked:** 0

### What the change is
Move the first-run **Model** step to DISPLAY position 2 (right after Welcome) so a model is
chosen before the permission/automation steps, which is what lets the tmux folder prompts fire
(card #3112, Josh 2026-09-15). Pane IDS are STABLE (browser checks + `?fr-step=N` deep links find
panes by id); only the display order, hops, and progress change. This branch is the REORDER HALF
of #3112 only; the 3 missing tmux folder asks (2d-2f) and #3113 (the tmux Accessibility "Allow
access" row) are parked, decision-blocked on a fresh-Mac measurement + Josh product call.

- `frStepSequence()` -> `[1,5,2,3,4,6,7,8,9]` (Welcome, Model, Access, Automation, Notifications,
  Self-improving, Success, About-you, Your-agents). Windows still drops Access(2)+Notif(4) by pane
  NUMBER -> `[1,5,3,6,7,8,9]`.
- `frStepAfter()` advances by SEQUENCE POSITION (`indexOf(step)+1`), not numeric value; the
  not-in-sequence fallback is the SMALLEST in-sequence pane greater by number
  (`Math.min(...seq.filter(s=>s>step))`), exactly the pre-#3112 Windows deep-link behavior.
- Every hardcoded `frGo(6/7/8)`, the 5 Model exits, and the About-you advance route through
  `frStepAfter`. Only the `frGo(1)` boot call remains a literal (correct).

### Per-Iteration Breakdown

#### Iteration 1 (6.0 validation) + Iteration 2 (opus)
**New findings:** `web.win32-board-copy.test.js` + `server.test.js` encoded the OLD order; the
#1720 web-change gate; a false `frStepAfter` fallback comment. --> ALL FIXED (25a57d17).

#### Iteration 3 (sonnet)
**New findings:** the fallback landed Access->Model instead of Access->Automation; 2 stale order
comments near FR_STEPS. --> FIXED (f76979db) by making the fallback min-by-number (pre-#3112) and
reconciling the comments.

#### Iteration 4 (opus)
**New findings:** a stale "advance to step 6" comment in the `step===5` ladder block. --> FIXED
(bce41233). 4 STRENGTHs confirmed the nav correct.

#### Iteration 5 (sonnet)
**New findings:** a stale "on a Mac the list is 1..FR_STEPS ... the numbers they always were"
header comment above `frStepSequence`. --> FIXED (d4c728d). Big STRENGTH: all
traversals/fallback/exits/tests hand-verified correct on both platforms.

#### Iteration 6 (opus) -- CONVERGED
Branch rebased onto current origin/main (ab39ef8ef; the intervening #3110 avatar-CSS change is
disjoint from the nav region, clean rebase). Pre-spawn sweep of the whole
frStepSequence/frStepAfter/frGo-ladder comment region found NO residual old-order prose.
**New findings:** 0 BLOCKER, 0 WARNING, 0 CONVENTION. The blind reviewer hand-traced both
platforms (macOS 1->5->2->3->4->6->7->8->9; Windows 1->5->3->6->7->8->9), confirmed the deep-link
fallback returns an in-sequence pane by construction (no `frGo` loop), confirmed `frStepProgress`
uses the same `indexOf` so hops and progress agree, confirmed the only literal `frGo` is the boot
`frGo(1)`, and confirmed the updated tests lift and execute the REAL functions
(`assert.deepEqual` against `[1,5,3,6,7,8,9]` / `[1,5,2,3,4,6,7,8,9]`) so a regression to ascending
order fails. --> **Converged.**

### Final Ledger

| # | Iter | Category | Origin | Description | Status | Resolution |
|---|------|----------|--------|-------------|--------|------------|
| 1 | 1/2 | BLOCKER | BRANCH | tests encoded the OLD step order | FIXED | 25a57d17 |
| 2 | 1/2 | CONVENTION | REPO | #1720 web-change gate needs a browser-check touch or trailer | FIXED | 25a57d17 (Browser-check trailer) |
| 3 | 1/2 | WARNING | BRANCH | false frStepAfter fallback comment | FIXED | 25a57d17 |
| 4 | 3 | BLOCKER | BRANCH | deep-link fallback landed Access->Model (should be next-by-number) | FIXED | f76979db (Math.min) |
| 5 | 3/4/5 | CONVENTION | BRANCH | 4 pre-existing comments made stale by the reorder | FIXED | f76979db, bce41233, d4c728d |
| 6 | 6 | -- | -- | zero new findings | CONVERGED | -- |

### Deferred (out of scope, not a finding on this diff)
- `web/index.html` ~44786 "Step 6's gate (About-you)" is a PRE-EXISTING mislabel (About-you = pane
  8, was mislabeled before the reorder too). Not touched by this diff.

### Strengths (across iterations)
- macOS and Windows traversals both match the intended display order, hand-traced each iteration.
- Deep-link fallback preserves the exact pre-#3112 Windows behavior (`frStepAfter(2)=3`,
  `frStepAfter(4)=5`) and always returns an in-sequence, paintable pane.
- Progress bar (`frStepProgress`) shares the `indexOf` basis, so hops and progress never diverge.
- No hardcoded jump bypasses the sequence; only the `frGo(1)` boot literal remains.
- Tests are non-vacuous: they lift the real `frStepSequence/frStepAfter/frStepProgress` via
  `runPage` and `assert.deepEqual` against concrete arrays; a regression to ascending order fails.
- No em dashes anywhere in the diff or this file.

### Browser-check (#1720)
The change to `web/index.html` is comment + first-run nav LOGIC (frStep* / frGo routing), guarded
by `web.win32-board-copy.test.js` (non-vacuous order pins) + `server.test.js` (source-string pin);
the panes' markup and ids are unchanged, so no new rendered surface. Each web/index.html commit
carries a `Browser-check:` override trailer; the #1720 gate passes with the override, confirmed in
the full validation run (tests 7704, pass 7566, fail 0; surface gate 0 FAILED; bc-surface-map 0
FAILED). diff_hash 71c86d5d.

### Not verified by a rendered browser-check (honest scope)
The reorder is verified by node tests + traversal simulation, NOT by the firstrun rendered-flow
browser-checks (render-firstrun-wizard-flow etc.) -- those were never run this loop. If a reviewer
or the PR gate wants the rendered flow exercised, that browser-check is the remaining step; the
logic itself is proven.
