---
pre_challenge: true
method: challenge-loop
branch: rst-kloader-2831
diff_hash: a0da669b78c0f69a20211aeaae169c4dc628f961c7586d04060716fc86c91b44
validation: passed
subdir_audit: passed
timestamp: 2026-09-12T14:21:30Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (blind reviewer passes; 6.0 baseline validation was clean)
**Converged:** Yes
**Total findings:** 9 actionable-tier (0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, + NITs/STRENGTHs)
**Fixed:** 5 (4 WARNINGs + 1 CONVENTION) | **Deferred:** 0 | **Asked (awaiting user):** 0

The multi-model rotation earned its keep here (kosmos#2032): the opus passes (iters 1, 3)
and the sonnet passes (iters 2, 4) found different things. Iteration 1 (opus) surfaced only
NITs; iteration 2 (sonnet) then found three real WARNINGs and a CONVENTION that the opus pass
missed. After those were fixed, iteration 3 (opus) found one further WARNING introduced by the
iter-2 focus fix, and iteration 4 (sonnet) found nothing new. Convergence is witnessed by both
models on the fixed code.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above (ITER_COMMITS empty; first reviewer pass on a clean 6.0 baseline)
- [NIT] web/index.html - placed-success copy can read as "we said hello / you say hello" (the plan's documented weakest premise; for Josh to eyeball, reversible)
- [NIT] web/index.html - focus falls to body during the hold (inherited from the shipped #2692 interstitial, not introduced here)
- [NIT] web/index.html - success-tail restore is redundant with openRestartModal's reset (belt-and-suspenders)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 0 new NITs
**Self-generated:** 0 of the above (all cite pre-existing lines / the feature commit; ITER_COMMITS still empty at review time)
- [WARNING] web/index.html:27890-27896 - Escape/backdrop unconditionally dismiss during the up-to-4400ms hold, but the restart is already POSTed, so dismissal silently implies "leave it running" when that is no longer an outcome (sibling changeDialog gates its Escape on goBtn.disabled) --> FIXED (436b5a4): added RST_BUSY, gated both exits
- [WARNING] web/index.html:27901-27914 - Tab-trap filtered on .disabled only, so it tried to focus the now-hidden rst-keep during the interstitial and silently no-oped --> FIXED (436b5a4): exclude .hidden too
- [WARNING] web/index.html:27956-28092 - reentrancy: the handler tail mutates the singleton modal DOM without re-checking it still owns it --> FIXED (436b5a4): stillMine = (RST_FOR === btn) guard on the tail
- [CONVENTION] commit bf39b86 - subject not in the `<branch> -- <message>` form --> FIXED: amended both commit subjects to `rst-kloader-2831 -- ...`

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above (the WARNING cites the Tab-trap line whose content predates ITER_COMMITS; the fix commit only edited whitespace/logic there, so blame stays on the base). The NIT is a dedup of iter-1's copy NIT.
- [WARNING] web/index.html - the iter-2 Tab-trap fix left a bare `return` when reachable is empty, so with no inert background native Tab escaped to the board behind the aria-modal during the hold --> FIXED (83c0292): preventDefault when reachable is empty (only reachable during the interstitial)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs (both dedups: the belt-and-suspenders restore, and the plan's own weakest-premise note)
**Self-generated:** 0
**Converged** - no new actionable findings; the model that caught the iter-2 WARNINGs finds nothing on the fixed code.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 2 | WARNING | web/index.html:27890 | BRANCH | Escape/backdrop dismiss during the committed-restart hold | FIXED | 436b5a4 (RST_BUSY gate) |
| 2 | 2 | WARNING | web/index.html:27905 | BRANCH | Tab-trap focuses a hidden control during the interstitial | FIXED | 436b5a4 (.hidden exclusion) |
| 3 | 2 | WARNING | web/index.html:27973 | BRANCH | reentrancy: tail mutates the singleton modal unconditionally | FIXED | 436b5a4 (stillMine guard) |
| 4 | 2 | CONVENTION | commit bf39b86 | BRANCH | commit subject not in `<branch> -- <message>` form | FIXED | amended both subjects |
| 5 | 3 | WARNING | web/index.html:27914 | BRANCH | Tab escapes the aria-modal when no control is reachable | FIXED | 83c0292 (preventDefault) |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] web/index.html - placed-success copy: "Restarted, and said hello to wake them. Say hello when you want to talk to them." reconciles #2686 (we auto-said hello) with #2831 (nudge the user); the plan flags this as its weakest premise, reversible in-app. Worth Josh eyeballing the exact wording.
- [NIT] web/index.html - focus rests on body during the hold (Tab is now contained by preventDefault; escape to the board is closed). Consistent with the shipped #2692 interstitial.
- [NIT] web/index.html - the success-tail restore (showConfirm(true)/RST_BUSY=false) is redundant with openRestartModal's next-open reset; kept as belt-and-suspenders, no visible flash since the modal hides immediately.

### Strengths (across all iterations)
- Reuses the existing RESTART_BUSY_HTML + startKLoader + RESTART_HOLD_MS trio (derived from K_LOADER_CYCLE_MS) rather than inventing a parallel loader or timing constant, so the two restart flows cannot drift (avoids the repo's documented top hazard, "two derivations of one fact").
- Preserves the delicate #2686 receipt split untouched (isConnected + CURRENT guards, placed-vs-manual honesty; noteFor(btn) before closeRestartModal; literal getElementById('rst-msg').textContent failure writes) and leaves the model/provider interstitial untouched.
- Correct teardown: closeRestartModal detaches the loader canvas so an Escape/backdrop dismissal during the hold cannot leak an rAF loop; the RST_BUSY flag is lowered on every exit so it never latches shut.
- New browser check render-restart-kloader-2831.js is genuinely red-capable (independently verified by two reviewers via source-stub mutation): it drives the real rst-go handler, reads painted canvas pixels, asserts the confirm content is hidden while it holds, proves Escape/backdrop are no-ops and Tab is preventDefault-contained during the hold, verifies exactly one auto-hello and the placed line with the nudge, proves canvas detachment after close, and bounds the REFUSED path's timing to prove no hold on failure.
