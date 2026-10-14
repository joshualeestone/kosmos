---
pre_challenge: true
method: challenge-loop
branch: tabletcards-6107
diff_hash: e5cc903e080757b5018cd23705fb3e046d3ef0a035803f25e1f74f005f6e134f
validation: passed (Mortals, full suite, clean entry for this hash)
subdir_audit: passed
timestamp: 2026-10-14T05:45:32Z
iterations: 20
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 20 (converged at 18 with zero NEW; two post-convergence fixes from the browser shots and a surface-gate trailer commit were reviewed again in 19, which found one NEW warning, fixed; 20 found zero NEW)
**Converged:** Yes
**Total findings (BLOCKER/WARNING/CONVENTION, after dedup):** 2 BLOCKERs, 37 WARNINGs, 3 CONVENTIONs, plus NITs below
**Fixed:** 36 | **Deferred:** 6 | **Asked (awaiting user):** 0

Reviewer models alternated: odd iterations opus, even iterations sonnet.
Self-generated (Origin) counts: not computed by blame. The branch was rebased three times during the loop,
which orphaned the loop's own commit shas, so every finding is recorded BRANCH (the fail-safe value).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 6 NITs
- [WARNING] web/index.html cards block: task text enlarged to .9375rem against Josh's .875rem ruling --> FIXED
- [WARNING] web/index.html .aname clipped: badge hidden, tap area cut, no ellipsis --> FIXED (no clip)
- [WARNING] queries did not test orientation; widths differed between cards and room --> FIXED (portrait, one range)
- [WARNING] card layout had no automated assertion --> FIXED (tablet arm in render-home-phone-718)
- [CONVENTION] plan "finished looks like" contradicted the branch --> FIXED
- NITs: tip walk label, reading-order note, 68rem edge, bare catch, phoneOnly at tablets, focused task card

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 6 WARNINGs, 0 CONVENTIONs, 3 NITs
- [WARNING] landscape control outside the width range could not test orientation --> FIXED (1024x768)
- [WARNING] cards block ignored the consolidated layout --> FIXED
- [WARNING] keyboard can flip a portrait viewport --> DEFERRED: recorded as a known limit in the plan
- [WARNING] sub-task indent inside the swipe row --> FIXED
- [WARNING] catch swallowed every ReferenceError --> FIXED (PJ_ORDER_READY var)
- [WARNING] room test merged blocks --> DEFERRED: the filter selects by exact query text, so a drifted block drops out and fails

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 6 NITs
- [WARNING] task row clipped focus rings --> FIXED (padding)
- [WARNING] composer scrolled on every placeLook paint --> FIXED (scroll only when a column moved)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
- [WARNING] no measure of needs-you card or long name --> FIXED (fit probe)
- [WARNING] task row had no browser assertion --> FIXED (stand-in cards probe)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
- [WARNING] snapped card ring clipped --> FIXED (scroll-padding)
- [WARNING] probe measured only the first card at scrollLeft 0 --> FIXED (fourth card after a scroll)
- [WARNING] stretched cards spread their lines --> FIXED (rows auto plus 1fr, align-content start)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, 3 NITs
- [WARNING] two across at 600px too narrow for a needs-you pill --> FIXED (330px floor, one across on small tablets)
- [WARNING] ring read from a modality-dependent computed outline --> FIXED (read the rule)
- [WARNING] cleo Answer might be absent --> FIXED by verification (fleet stub makes agents ours; strict 'in')
- [WARNING] scroller clips vertically --> DEFERRED: no max-height, the row grows to its cards
- [WARNING] landscape tablets skip consolidated shots --> DEFERRED: belongs to the landscape slice (done on landshots-6107)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
- [WARNING] state pill centred by base auto margins --> FIXED (margin 6px 0 0, alignment asserted)
- [WARNING] focus in the moving Tasks column untested --> FIXED (New task arm)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
- [WARNING] WebKit touch reporting unknown --> FIXED (precondition)

#### Iteration 9
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 2 WARNINGs, 1 CONVENTION, 3 NITs
- [BLOCKER] docs/browser-checks/render-room-msgbox-2806.js: outline-width reads empty for a var() shorthand, so ring was 0 and the arm could only fail --> FIXED (read the shorthand text; measured in both engines)
- [WARNING] branch 78 commits behind main --> FIXED (rebased)
- [WARNING] tip walk now in the tablet layout --> FIXED by running it (passed in the room check)
- [CONVENTION] shots header comment --> FIXED

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
- [WARNING] task-row probe did not un-hide ancestors --> FIXED

#### Iteration 11
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
- [WARNING] WebKit arm always red --> FIXED at the time (Chromium only); reverted in iteration 17 after measuring
- [WARNING] narrowest two-across width unmeasured --> FIXED (744x1133 arm)

#### Iteration 12
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
- [WARNING] row-gap dead space from empty rows --> FIXED
- [WARNING] PJ_ORDER_READY not pinned --> FIXED (test)

#### Iteration 13
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
- [WARNING] no tip walk in the wide single-column layout --> FIXED (1024x768 arm)

#### Iteration 14
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
- [WARNING] no guard that every card line sits in a named area --> FIXED (unplaced audit)

#### Iteration 15
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
- [WARNING] pageFits compared to innerWidth, which grows when a mobile viewport zooms out --> FIXED (clientWidth)

#### Iteration 16
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
- [WARNING] wide tip arm checked only the order prefix --> FIXED (full order)

#### Iteration 17
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING (premise disproved), 0 CONVENTIONs, 3 NITs
- [WARNING] WebKit tablet shots would not show the tablet layout --> DEFERRED as not an issue: measured, Playwright WebKit with hasTouch reports hover none and pointer coarse; the iteration-11 WebKit skip was reverted

#### Iteration 18
**Reviewer model:** sonnet
**New findings:** 0 (all duplicates of resolved or deferred entries)
**Converged** on the code as it stood.

Post-convergence, from the browser shots and the surface gate: a wrapped name was centred (FIXED, asserted),
Members/Files stretched side by side (FIXED), and eight surface-mapped checks were excused by trailer after
reading each one's contexts (none opens a touch context in the tablet range).

#### Iteration 19
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
- [WARNING] nothing proved a mouse at tablet portrait size keeps the desktop layout --> FIXED (mouse control arm; test pins the touch and portrait clauses)

#### Iteration 20
**Reviewer model:** sonnet
**New findings:** 0 (duplicates: reading order, the ready-flag pin, foldables in the plan)
**Converged** — no new actionable findings.

### Final Ledger (actionable, grouped)

| # | Iter | Category | File | Origin | Description | Status |
|---|------|----------|------|--------|-------------|--------|
| 1 | 9 | BLOCKER | render-room-msgbox-2806.js | BRANCH | var() shorthand ring read as 0 | FIXED |
| 2 | 1 | WARNING | web/index.html | BRANCH | task text size against ruling | FIXED |
| 3 | 1 | WARNING | web/index.html | BRANCH | name clipped | FIXED |
| 4 | 1 | WARNING | web/index.html | BRANCH | no orientation clause | FIXED |
| 5 | 2 | WARNING | web/index.html | BRANCH | keyboard flips portrait | DEFERRED: known limit in plan |
| 6 | 6 | WARNING | web/index.html | BRANCH | 600px two-across too narrow | FIXED |
| 7 | 7 | WARNING | web/index.html | BRANCH | pill centred by auto margins | FIXED |
| 8 | 8+ | WARNING | web/index.html | BRANCH | card reading order differs for plain text lines | DEFERRED: nothing focusable moves; stated in the CSS comment |
| 9 | 15 | WARNING | render-room-msgbox-2806.js | BRANCH | innerWidth grows on zoom-out | FIXED |
| 10 | 19 | WARNING | render-home-phone-718.js | BRANCH | no mouse control | FIXED |
| (others) | 1-19 | WARNING/CONVENTION | various | BRANCH | as listed per iteration | FIXED or DEFERRED as stated |

### Outstanding questions
None.

### Design notes for Josh (not defects; in the plan)
- An empty Tasks block sits above the conversation on an upright tablet.
- A sub-task loses its indent in the sideways Tasks row.
- The project tip's step order no longer follows the tablet screen order.

### Strengths (across all iterations)
- The room is reordered by DOM moves, never CSS order (#1017); the composer column never moves; focus survives in both moving columns.
- Every browser arm has a control that can fail: landscape, mouse, back at 375, the restore flag.
- Probes read real values (the page's own focus rule) and restore the page in a finally.

### Evidence outside the loop
- render-room-msgbox-2806 (headed, Agent1s, 22:11): all arms PASS, 0 FAIL, including the six tablet and wide arms.
- render-home-phone-718 (22:29): all tablet card arms PASS (834, 744, 600, landscape control). The mouse control was added after; its run is queued.
- Shots: ~/work/design-shots/kosmos-6107/cards and room (0 overflow, 0 errors).
