---
pre_challenge: true
method: challenge-loop
branch: projects-map-view-2458
diff_hash: 3552f12a1cedd2954c8955524f738883bf6cb575c2c3fdad2373ebeeb8ce671e
validation: passed
subdir_audit: passed
timestamp: 2026-09-08T06:27:25Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (on the complete feature; each reviewed the FULL branch diff)
**Converged:** Yes (iteration 4 returned zero NEW BLOCKER/WARNING/CONVENTION findings)
**Total actionable findings:** 0 BLOCKERs (surviving), 4 WARNINGs, 0 CONVENTIONs, plus NITs
**Fixed:** 4 WARNINGs + 6 NITs | **Deferred:** 4 NITs | **Asked:** 0

The Projects tab Map view (#2458) is a top-down CSS org-chart of the project tree behind
the Grid/Map toggle, built to Mona's design/subprojects.html (#112). It survived a design
round-trip: the design owner first redirected it to mirror the radial agent org-view, then
self-corrected (that page is radial with no pan/fold/scroll; the confusion was a
count-is-not-instances grep error), confirming the original top-down chart. The three spec
additions (click-to-open, per-branch fold, two-direction scroll) were then built onto it.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKER, 1 WARNING, 0 CONVENTION, 5 NITs
- [WARNING] the node button's aria-label "Open <name>" overrode the subtree, hiding the
  needs-you / count status from screen readers (WCAG AA) --> FIXED (94a30cc3): status folded
  into the accessible name; asserted.
- [NIT] dead #pj-new-empty handler + inaccurate comment --> FIXED (94a30cc3).
- [NIT] PJ_MAP_FOLDED never pruned --> FIXED (94a30cc3): pruned to live ids on render.
- [NIT] .pjonode lacked appearance:none --> FIXED (94a30cc3).
- [NIT] dark assertion only covered the text, one spelling --> FIXED (94a30cc3): now pins
  the border too, in both dark spellings.
- [NIT] worded setup-failure browser-check prefixes --> DEFERRED: sibling-consistent, and
  marker-ising them would change the reason-grep count.

#### Iteration 2
**New findings:** 0 BLOCKER, 2 WARNINGs, 0 CONVENTION, 4 NITs
- [WARNING] folding destroyed keyboard focus (repaint recreates the button) --> FIXED
  (5780db81): focus re-homed onto the same fold button; asserted.
- [WARNING] the fold disclosure was under the WCAG 2.2 SC 2.5.8 (AA) 24x24 target minimum
  --> FIXED (5780db81): a 24x24 hit area around the quiet triangle.
- [NIT] data-fold collided with the pre-existing rail column-fold namespace --> FIXED
  (5780db81): renamed to data-pjfold.
- [NIT] count truthiness on a "0" string --> FIXED (5780db81): Number(s.total) > 0 guard.
- [NIT] worded prefixes (dup) --> DEFERRED. [NIT] connector color is --k-rule (may be under
  SC 1.4.11) --> DEFERRED: Mona's spec, and the hierarchy is also conveyed by nesting so the
  lines are not a sole indicator -- flagged to Mona rather than diverged from the merged spec.

#### Iteration 3
**New findings:** 0 BLOCKER, 1 WARNING, 0 CONVENTION, 1 NIT
- [WARNING] a stale comment still said the fold used data-fold after the rename --> FIXED
  (9f346e86): corrected to data-pjfold, so a maintainer is not misdirected to the rail
  namespace (the exact collision the rename removed).
- [NIT] reason-grep audit-trail prose off by one (constants 74/46 correct) --> FIXED (9f346e86).

#### Iteration 4
**New findings:** 0 BLOCKER, 0 WARNING, 0 CONVENTION, 1 NIT
**Converged.** "No blockers, warnings, or convention violations. The feature is correct and
well-guarded." Four STRENGTHs confirmed the boot-TDZ guard, cycle/orphan/fold handling, the
a11y depth, and the reason-grep count discipline.
- [NIT] a malformed self-parent record (p.parent === p.id) would show an inert fold
  disclosure --> DEFERRED: engine cleanParent refuses self-parents; cosmetic (the "never
  double / never drop" invariant holds, node renders once); and the map's `par` computation
  MATCHES the existing shipped pjTreeRows (the list tree), so guarding only the map would
  diverge the two tree-builds.

### Outstanding questions (ASKED)
- None. (One design NIT flagged to Mona for her call: the connector line contrast -- her
  spec's --k-rule choice; not a blocker, the hierarchy is redundantly conveyed by nesting.)

### Strengths (across iterations)
- Cycle/orphan/fold invariants are robust and directly tested: seen guard + markSeen for
  folded subtrees + the stranded backstop's inner re-check, traced across 2-node, deep
  (a->b->c->a), and pure-cycle shapes -- nothing doubles or vanishes.
- The boot-no-paint TDZ guard is load-bearing and pinned by a dedicated assertion (a saved
  'map' would otherwise read PROJECTS/PJ_SORT/LAST in their temporal dead zone and halt boot).
- Accessibility handled where it bites: status in the accessible name, a real 24x24 fold
  target, focus re-homed after the destructive repaint, dark-mode attn contrast lifted in
  both spellings -- each pinned by a dangerous-answer control.
- Toggle-gating (pjHasSubprojects) mirrors the tree build's own active-parent test, so the
  button and the render never disagree. reason-grep counts (74/46), README row, and runner
  list all in lockstep. Forced-theme dark twins generated (not hand-written). No em dashes.
