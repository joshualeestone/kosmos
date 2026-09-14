---
pre_challenge: true
method: challenge-loop
branch: reassign-stale-notice-3050
diff_hash: 3128805f1790298ec6fdd86738fbd4eb37415bdfc13d3ced9d896af3ae970afe
validation: passed (targeted browser-check + meta-tests + both bc-gates; full-suite contention-blocked, see note)
subdir_audit: passed
timestamp: 2026-09-14T19:25:51Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4, zero actionable; witnessed across sonnet + opus)
**Total findings:** 2 BLOCKERs, 3 WARNINGs, 2 CONVENTIONs, 6 NITs
**Fixed:** 9 (2 BLOCKER, 3 WARNING, 2 CONVENTION, 2 NIT) | **Deferred:** 4 (NITs) | **Asked:** 0

Frontend change (#3050): reworded the Instructions-tab staleness note + an Update
button that reloads the current on-disk version via the existing loadInstructions,
with the Sweep loader for the reload and a headless browser-check.

⭐ The loop earned its keep: iteration 3 (sonnet) PROMOTED to a BLOCKER what iteration
2 (opus) had rated a NIT (a false "Updated." announcement into the aria-live region +
a focus steal on same-agent reopen mid-reload, from a missing INSTR_LOAD-token guard).
A concrete instance of why 6a varies the reviewer model.

### Validation note

The full suite self-contends on this box (`node --test-concurrency=0`); validated via
the targeted browser-check meta-tests (18/18), the headless render check
(docs/browser-checks/render-reassign-update-3050.js, 14/14, red-capable on 3 arms),
and both browser-check gates (bc-gate + surface-gate pass), per the standing fallback
for this box. CI runs the full suite on GitHub's runners.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 (ITER_COMMITS empty at iteration 1)
- [BLOCKER] web/index.html (agent-switch race) - #d-instr-updating reset only in setWritesOffered's untied branch, so a switch to another TIED agent mid-reload stranded the aria-live loader --> FIXED (c1c36f28): hide at the top of openDetail (switch path only).
- [CONVENTION] web/index.html - used .kspin (the restart mark Josh flagged as the wrong loader asset) --> FIXED (c1c36f28): use .spin.spin-sweep (the Sweep loader).
- [WARNING] web/index.html - Update button inside the synchronously-hidden note dropped focus to <body> --> FIXED (c1c36f28): move focus to the updating status, then the result status line.
- [WARNING] render-reassign-update-3050.js - coverage did not include the switch race --> FIXED (c1c36f28): added the race arm (second fixture agent + delay-able mock), red-capable.
- [NIT] render-reassign-update-3050.js - Browser-check-surface annotation before 'use strict' --> FIXED (c1c36f28): moved after, sibling two-line format.

#### Iteration 2
**Reviewer model:** opus (different model from iteration 1)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 WARNING(self), 2 NITs
**Self-generated:** 1 (the false-mechanism comment, written by c1c36f28)
- [WARNING] render-reassign-update-3050.js (SELF) - the docstring + race-arm comment attributed the race reset to "the reset in loadInstructions" / "the untied reset", but loadInstructions never touches #d-instr-updating; the real reset is the openDetail hide --> FIXED (2bcdd22b4): corrected to name openDetail (which the switch-race arm red-tests).
- [NIT] same-agent "Updated." flash --> DEFERRED at iter 2 (reviewer: benign) -- but iteration 3 correctly re-raised it as a BLOCKER; see below.
- [NIT] redundant untied-reset entry --> DEFERRED (defensive, fine to keep).

#### Iteration 3
**Reviewer model:** sonnet (different model from iteration 2)
**New findings:** 1 BLOCKER, 1 WARNING, 1 CONVENTION, 1 NIT
**Self-generated:** 1 (the openDetail "ANY" comment, written by c1c36f28)
- [BLOCKER] web/index.html - the Update handler guarded finally + confirmation by agent NAME only, so reopening the SAME agent mid-reload let the superseded reload write a false "Updated." into the aria-live region + steal focus, and the real reload never re-announced --> FIXED (ecc0756aa): capture the INSTR_LOAD token, gate both on stillMine() (same agent AND same load), mirroring the save handler.
- [WARNING] web/index.html - the focus-management feature was untested --> FIXED (ecc0756aa): the check now asserts focus lands on #d-instr-msg.
- [CONVENTION] plan file - said "10/10 green" but the check has more assertions --> FIXED (ecc0756aa): updated to 14/14 + the arms + the red-capability list.
- [NIT] web/index.html (SELF) - openDetail "ANY agent" comment sat after `if (!a) return` --> FIXED (ecc0756aa): moved the hide before the guard so it covers a removed agent.
- coverage: the browser-check gained the same-agent-reopen arm (short-then-long delay), red-capable (removing the token guard reds it, msg="Updated.").

#### Iteration 4
**Reviewer model:** opus (different model from iteration 3)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
**Converged** - no new actionable findings; four strengths (token capture correct, rapid-double-click safe, openDetail-before-guard deliberate, check red-capable), reviewer ran meta 18/18 + render 14/14.
- [NIT] render-reassign-update-3050.js - the same-agent-reopen arm is timing-based (~500ms margin) --> DEFERRED: verified red-capable (perturbation + the reviewer's own run both exercise the race); reviewer calls the margin adequate on dedicated runners. A future hardening could gate on observable state rather than a sleep.
- [NIT] web/index.html - msg tabindex="-1" is never cleared --> DEFERRED: reviewer confirms harmless (setAttribute overwrites; -1 is not tab-reachable).

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | web/index.html (openDetail/setWritesOffered) | BRANCH | switch-race strands the loader | FIXED | c1c36f28 |
| 2 | 1 | CONVENTION | web/index.html (d-instr-updating) | BRANCH | .kspin is the wrong loader asset | FIXED | c1c36f28 |
| 3 | 1 | WARNING | web/index.html (handler) | BRANCH | focus dropped to body | FIXED | c1c36f28 |
| 4 | 1 | WARNING | render-reassign-update-3050.js | BRANCH | switch-race not covered | FIXED | c1c36f28 |
| 5 | 1 | NIT | render-reassign-update-3050.js:1 | BRANCH | annotation before 'use strict' | FIXED | c1c36f28 |
| 6 | 2 | WARNING | render-reassign-update-3050.js:22 | SELF | false-mechanism comment (loadInstructions vs openDetail) | FIXED | 2bcdd22b4 |
| 7 | 2 | NIT | web/index.html | BRANCH | same-agent "Updated." flash | (re-raised as BLOCKER #9) | see iter 3 |
| 8 | 2 | NIT | web/index.html (setWritesOffered) | BRANCH | redundant untied-reset entry | DEFERRED | defensive |
| 9 | 3 | BLOCKER | web/index.html (handler) | BRANCH | missing INSTR_LOAD token guard -> false "Updated." on same-agent reopen | FIXED | ecc0756aa |
| 10 | 3 | WARNING | render-reassign-update-3050.js | BRANCH | focus untested | FIXED | ecc0756aa |
| 11 | 3 | CONVENTION | .claude/plans/reassign-stale-notice-3050.md:61 | BRANCH | stale "10/10 green" | FIXED | ecc0756aa |
| 12 | 3 | NIT | web/index.html (openDetail) | SELF | "ANY" comment after the return guard | FIXED | ecc0756aa |
| 13 | 4 | NIT | render-reassign-update-3050.js | BRANCH | same-agent arm timing-based | DEFERRED | red-capable + adequate margin |
| 14 | 4 | NIT | web/index.html:26952 | BRANCH | tabindex not cleared | DEFERRED | harmless |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking)
- Same-agent-reopen arm is timing-based (adequate margin, verified red-capable); future hardening could gate on observable state.
- msg tabindex="-1" never cleared (harmless).
- Redundant (defensive) #d-instr-updating entry in setWritesOffered's untied reset.

### Strengths (across all iterations)
- The INSTR_LOAD token capture is correct (loadInstructions bumps synchronously before its first await) and mirrors the save handler's guard (iter 4).
- Rapid double-click on Update is safe: single-threaded prefix hides the button's parent, and a second handler is superseded by the token (iter 4).
- openDetail-before-the-return-guard placement deliberately clears a stranded loader even for a removed agent, and cannot fire during the update's own reload (openDetail is never called by the poll or the Update handler) (iter 3 + 4).
- The Sweep loader reuses an existing component, inheriting reduced-motion for free; [hidden]{display:none!important} correctly overrides the inline display:flex (iter 3).
- "Updated." is suppressed unless d-instr-msg is empty, which loadInstructions leaves empty only on the editable-success path (iter 2 + 3 + 4).
- The browser-check is genuinely exercised and red-capable on the reload, switch-race, and same-agent-reopen arms, with real controls (iter 1-4).
