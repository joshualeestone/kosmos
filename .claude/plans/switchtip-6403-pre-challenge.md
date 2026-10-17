---
pre_challenge: true
method: challenge-loop
branch: switchtip-6403
diff_hash: 7a20d53bee51e1c17d308136dffbd78fd65c1fb052b0e1e2d0aedaded196e210
validation: pending (render-connect-sheet-4637's new arms start a board and run in PR CI's browser-checks job, the merge gate; render-onekosmos-4815 152/152 locally after the rebase onto main)
subdir_audit: passed
timestamp: 2026-10-17T22:05:37Z
iterations: 17
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 17 (alternating opus and sonnet)
**Converged:** Yes
**Total findings:** recorded per iteration in the commit messages (32845c3c to 5057037e, then the iteration-17 notes) and the plan's review log
**Fixed:** every BLOCKER and WARNING | **Deferred:** 4 NITs (iteration 17) | **Asked (awaiting user):** 0

Card #6403 (Josh asked for the tip): the computer switcher shows without a reload once a second computer is allowed, and
a one-time tip next to it says how to switch. Rebased onto main after #6396 (PR #6412) merged.

### Per-Iteration Breakdown

#### Iterations 1-11
- [WARNING] iteration 1 — look-back reads unbounded during failures; follow-up reads after a forced read --> FIXED (32845c3c)
- [WARNING] iterations 2-6 — the seen flag set when nobody could see the tip (hidden tab, phone layout), forced read while hidden --> FIXED (060366c3 to eba0b9d6: worldswTipMarkSeen)
- [WARNING] iteration 7 — a click-through tip pressed controls under it --> FIXED (2ab81b88: the tip takes clicks)
- [WARNING] iterations 8-9 — other checks' clicks eaten by the tip; the tip outliving the switcher --> FIXED (e59ee68a, 3b4e2880)
- [WARNING] iterations 3-11 — Escape handling colliding with dialogs and the composer --> FIXED by REMOVAL in iteration 12

#### Iteration 12
**Reviewer model:** sonnet
- [WARNING] Escape took focus away and beat other handlers --> FIXED (5e4675f9: no Escape handling; dismissible by close, click, menu)

#### Iterations 13-16
- [WARNING] iteration 14 — the "never lands under it" claim had no hit test --> FIXED (cb5250ee: a real mouse click over a planted control, with CONTROL)
- [WARNING] iteration 15 — a stale "not signed in" blocked look-backs on the computer just let in --> FIXED (c90da4ac: computersSignedInNow, CONTROL)
- [CONVENTION] iteration 16 — plan limits (any end of a wait, hidden follow-up window) --> FIXED (5057037e)

#### Iteration 17
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
- [NIT] a narrow STALE_FORCED leftover; connect-sheet reach assert could be exact; mobile-shots cannot drive the tip; narrow-width overflow (measured: none, right edge 344 at 400px)
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 7 | WARNING | web/index.html worldsw-tip | BRANCH | tip let clicks through | FIXED | 2ab81b88 |
| 2 | 12 | WARNING | web/index.html Escape | SELF | Escape collisions | FIXED | 5e4675f9 (removed) |
| 3 | 14 | WARNING | render-onekosmos-4815.js | BRANCH | no hit test | FIXED | cb5250ee |
| 4 | 15 | WARNING | web/index.html paintPlus | BRANCH | stale not-signed-in | FIXED | c90da4ac |
| 5 | 17 | NIT | web/index.html | BRANCH | STALE_FORCED leftover | DEFERRED | narrow, costs a few reads |

### Validation
- After the rebase onto main: render-onekosmos-4815.js 152/152 (Chromium + WebKit, light + dark); web.computers-switcher-4648, web.allow-card, web.plus-tab, web.plus-stale, web.task-say-outcome-5842, web.world-import-2563: 0 failing; both browser-check gates 0.
- Mutants red during the loop: no focus read, no seen memory, no close handler, no tab-shown read, click-through, no drop.
- render-connect-sheet-4637's #6403 arms start a board: PR CI's browser-checks job runs them.
- Screenshots: ~/work/design-shots/kosmos-6403/switch-tip--{desktop,narrow}--{light,dark}.png.

### NITs (non-blocking, across all iterations)
- see iteration 17

### Strengths (across all iterations)
- reads are bounded: once a minute on a look, never during failures, forced only on Allow or being let in (iterations 1-17)
- seen only when a person could see it (iterations 5-17)
