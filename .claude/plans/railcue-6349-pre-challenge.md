---
pre_challenge: true
method: challenge-loop
branch: railcue-6349
diff_hash: 53289051a21480a981293d8c608c69c963daa60c6dcfa18110ebc4d6fa3d4431
validation: pending (render-projects.js on this head is queued locally (bc-6349-rp4.log) and runs in PR CI's browser-checks job, the merge gate; the pre-rebase head passed it at 12:40 and passed Mortals validation at 3271ac2f)
subdir_audit: passed
timestamp: 2026-10-17T19:22:20Z
iterations: 18
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 18
**Converged:** Yes
**Total findings:** iterations 1-15 were recorded per iteration in their commit messages and the plan's review notes (counts by category were not kept); iterations 16-18: 3 BLOCKER-or-WARNING findings fixed, 2 decided, 9 NITs.
**Fixed:** every BLOCKER and WARNING in iterations 1-17 | **Deferred:** 2 (forced colors, the sticky 2px offset) | **Asked (awaiting user):** 0

Card #6349: the capped notice at the top of the consolidated agents rail gets a fade while more is below it (a Mac hides
the scrollbar at rest). The branch was rebased onto main at iteration 16 (main had added #6324's Team map cap beside it).

### Per-Iteration Breakdown

#### Iterations 1-15 (alternating opus and sonnet; from the commit log, c0fa2764 to e061729a)
**Self-generated:** iterations 3-8 reviewed the focus extras that iteration 1 added
- [WARNING] iteration 1 — a notice changed while the rail was folded kept a stale cue --> FIXED (c0fa2764: the box's own ResizeObserver)
- [WARNING] iteration 2 — a row reflowing with no row added or removed left the fade stale --> FIXED (4d96ab15: each row watched by size)
- [WARNING] iterations 3-8 — the keyboard focus nudge and scroll padding each produced a new defect (WebKit focus scroll, a click moved from under the pointer, a right-click leaving the nudge off) --> FIXED, then REMOVED at iteration 9 (e8fad9af): a control under the fade is dimmed, never hidden, which meets WCAG 2.4.11 at AA
- [BLOCKER] iteration 7 — any element's blur cleared the pressed flag, so a click could be nudged mid-press and lost --> FIXED (f2813921), then the whole nudge removed (e8fad9af)
- [WARNING] iteration 6 — the arm could crash on a notice already taller than the window --> FIXED (2ac8d25e)
- [NIT] iteration 10 — fade height defined on the box the rule targets; arm tidy --> FIXED (401ccc53)
- [WARNING] iteration 13 — only the rows' watchers answered the unfold step; the box's own cap shrinking was untested --> FIXED (2d3d7dbb)
- [WARNING] iterations 14-15 — the design-shot screen could be put back on tabs mid-shot --> FIXED (425a4d24, e061729a)
- [WARNING] iteration 14 — forced colors has no cue --> DEFERRED (stated in the plan: a wrong-coloured band is worse)

#### Iteration 16
**Reviewer model:** sonnet (after the rebase)
**New findings:** 0 BLOCKERs, 3 WARNINGs, 2 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] render-projects.js:1293 — #6324's real Team map cap was never exercised --> FIXED (4f7cc9bb: the arm shows the button)
- [WARNING] web/index.html:5386 — the fade's last pixels fully cover a control --> FIXED as a stated trade (4f7cc9bb: the comment says so)
- [WARNING] web/index.html:5386 — the sticky strip sits 2px above the edge --> DEFERRED (cosmetic)

#### Iteration 17
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above (the Team map step from iteration 16)
- [BLOCKER] render-projects.js:1334 — the fixture already shows Team map, so the step could never see the cap drop --> FIXED (40fbfe77: hide first, read the full cap, then show; repaint held; restored in finally)
- [WARNING] plan — no green run on the final head, shots not retaken --> owed: both queued; PR CI runs render-projects
- [WARNING] render-projects.js — a poll could change state mid-arm --> FIXED for the Team map repaint (40fbfe77); same-shape repaints are no-ops

#### Iteration 18
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 new WARNINGs, 0 CONVENTIONs, 3 NITs
**Duplicates of prior findings (confirmed resolved or decided):** 2 (the owed run and shots; the forced-colors gap)
- [NIT] plan said "no fixed height" while the fade is 28px --> FIXED (plan wording)
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html railPjMore | BRANCH | stale cue after unfold | FIXED | c0fa2764 |
| 2 | 2 | WARNING | web/index.html railPjMore | BRANCH | row reflow left it stale | FIXED | 4d96ab15 |
| 3 | 7 | BLOCKER | web/index.html focus nudge | SELF | click lost mid-press | FIXED | e8fad9af (removed) |
| 4 | 13 | WARNING | render-projects.js | BRANCH | cap shrink untested | FIXED | 2d3d7dbb |
| 5 | 14 | WARNING | web/index.html:5387 | BRANCH | no cue in forced colors | DEFERRED | plan |
| 6 | 16 | WARNING | render-projects.js:1293 | BRANCH | Team map cap untested | FIXED | 4f7cc9bb |
| 7 | 16 | WARNING | web/index.html:5386 | BRANCH | sticky 2px offset | DEFERRED | cosmetic |
| 8 | 17 | BLOCKER | render-projects.js:1334 | SELF | step could not see the cap drop | FIXED | 40fbfe77 |

### Validation
- Pre-rebase head 3271ac2f: Mortals validation clean; render-projects.js passed locally (12:42, "all page checks passed"); shots rail-notice-more taken (2 shots, 0 overflow, 0 errors).
- This head: both browser-check gates (#1720, #2518) 0; browser-checks-reason-grep 7/7; node --check on render-projects.js and mobile-shots.js.
- render-projects.js on this head: queued locally and run by PR CI's browser-checks job (the merge waits on it). Shots retaken on the rebased page are queued (shots-6349b.log).

### NITs (non-blocking, across all iterations)
- see the per-iteration lists above

### Strengths (across all iterations)
- the arm measures "more below" with the cue taken off, so the cue cannot hold itself on (iterations 13-18)
- every observer has a step only it can pass (iterations 2-18)
- the fade adds no height and never takes a click (iterations 1-18)
