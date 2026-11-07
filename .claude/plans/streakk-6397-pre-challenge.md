---
pre_challenge: true
method: challenge-loop
branch: streakk-6397
diff_hash: 53526101f1907ef792cd5cd7865eb8b107d01639ad9b40203049fe7c0e215c13
validation: passed
subdir_audit: passed
timestamp: 2026-11-07T08:37:27Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (the cap; no ninth pass)
**Converged:** Stopped at the cap. Round 8 found no BLOCKER; its 4 WARNINGs were fixed (W1-W3) or are latent (W4).
**Reviewers:** opus and sonnet alternating, every round on the whole branch.

Validation (local, this exact tree): render-streak-6160.js 161 rows pass on a sandboxed board; the 11 browser checks the
surface gate flagged pass on this branch; static guard set 3815/3815; surface gate and #1720 gate pass.
Perturbations: 23 applied to the page, 22 turned the check red. One stayed green (the watch measuring at rest, review 4):
measured, mid-slide top 43 px against the switcher's bottom 41 px, so the old reading cleared it at this layout; kept
as defensive, no arm can make it red here.

### Iteration 1 (opus, whole branch)
- [WARNING] the pill covered the computer switcher and, at 601-1000 px, the tabs --> FIXED (measured placement: beside, below, else the notice)
- [WARNING] a status region revealed and filled in one update is often skipped --> FIXED (always-present .vh region; the pill aria-hidden)
- [WARNING] Escape folded the pill even when another control used it --> FIXED (defaultPrevented, dialogs, menus, .worldsw)
- [WARNING] a resize across 600 px left the pill out --> FIXED (a width change folds it)
- [WARNING] the phone notice lost its assertions --> FIXED (wording, role, Dismiss label, gold, focus return)
- [WARNING] hovering the pill did not hold it --> FIXED
### Iteration 2 (sonnet, whole branch)
- [WARNING] a reload during the pill lost pill and badge for the day --> FIXED (day kept at show)
- [WARNING] a mouse click on the mark pinned the pill --> FIXED (:focus-visible)
### Iteration 3 (opus, whole branch)
- [WARNING] a fold before the first frame left the pill stuck --> FIXED (frame guard)
- [WARNING] placement measured at the entrance pose --> FIXED (.measure, the resting transform)
- [WARNING] the hover label drew under the pill --> FIXED
- [WARNING] the phone notice lost the badge on a reload --> FIXED (day kept at show)
- [WARNING] the 6 s could run out under the loading cover --> FIXED (waits for it; reasoned, not staged)
### Iteration 4 (sonnet, whole branch)
- [WARNING] the watch measured mid-slide --> FIXED (at rest); its perturbation stays green, measured why (top 43 vs 41)
- [WARNING] a background tab spent the 6 s unseen --> FIXED (waits while hidden; timer and watch start in the frame)
- [WARNING] fixed sleeps in the check --> FIXED (waits for the pill)
### Iteration 5 (opus, whole branch)
- [WARNING] hover stuck on a tablet held the pill forever --> FIXED ((hover: hover) only)
- [WARNING] a height-only resize folded it --> FIXED (width only)
- [WARNING] a watch fold lost the day's words --> FIXED (hands to the notice)
### Iteration 6 (sonnet, whole branch)
- [WARNING] the slide never played --> FIXED (transition off through the flush)
- [WARNING] read out twice on a hand-over --> FIXED (the handed-over notice has no role)
- [WARNING] a same-day refresh shows the badge beside the pill --> CHECKED, FALSE (streakCheck returns early for a settled day)
### Iteration 7 (opus, whole branch)
- [WARNING] negative arms read too early --> FIXED (settled())
- [WARNING] a wait across midnight showed yesterday's words --> FIXED (dropped past its day; reasoned)
- [WARNING] the tablet premise unproven --> FIXED (:hover asserted)
- [WARNING] a badge alone counted as the words shown --> FIXED
- [WARNING] a stale comment --> FIXED
- [NIT] badge ring colour, keyboard hold unproven --> FIXED
### Iteration 8 (sonnet, whole branch, the cap)
- [WARNING] beside not tested against notices --> FIXED (reasoned; no layout found where it bites)
- [WARNING] the welcome opening after the pill --> FIXED (it holds the pill)
- [WARNING] a held pill across midnight dropped the new day's --> FIXED (reasoned)
- [WARNING] fold(true) with no #streak-slot --> LEFT (latent: the slot always exists)
### After iteration 8
- The width fold moved into the watch: a static test reads the page's resize listener and mine shadowed it.
