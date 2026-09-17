---
pre_challenge: true
method: challenge-loop
branch: nav-badges-tree-fit
diff_hash: bbcd6c62387dc27195759f4e161f452353244ccfe8bd0cfaa4cdec53bb262b36
validation: passed
subdir_audit: passed
timestamp: 2026-09-17T18:45:31Z
iterations: 9
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 9 (blind passes alternating Sonnet/Opus)
**Converged:** Yes (pass 9 Opus CLEAN; pass 8 Sonnet demanded the settled design and pass 9 Opus confirmed its correct implementation, so convergence is witnessed by both models -- kosmos#2032)
**Total findings:** 3 BLOCKERs, 4 WARNINGs, 3 CONVENTIONs, several NITs
**Fixed:** all BLOCKERs/WARNINGs/CONVENTIONs | **Deferred:** the pass-9 NITs (non-behavioral) | **Asked:** 0

#3216 (Josh 6.74, investor meeting, via Splinter): red unread-count badges on the Agents and
Projects nav tabs. Agents = fleet dmTotal (same total as the #st-dm tile). Projects = the
always-polled counts.projectsUnread (Angel's engine field, #3219) minus the open ACTIVE room's own
unread (option i). setNavBadge(id,n) hides at null/<=0/NaN and caps at 99+; shared unread red
#b3261e/#fff light, #ff8c82/#0c0d0f dark (both dark rules). Hermetic browser-check
render-nav-badges-3216.js (18 assertions incl. two dark-theme paths and a viewport geometry arm,
all positive-control-proven). Node suite 7797 tests, 0 fail; #1720 coarse gate satisfied (touches
docs/browser-checks/); #2518 surface gate passed via a per-check override trailer (the diff
references .dmbadge only in comments, does not change that surface).

### Per-Iteration Breakdown

#### Iteration 1 (Sonnet)
- [BLOCKER] Projects badge summed UNFILTERED PROJECTS (archived rooms carry unread nothing else
  shows; a duplicate derivation) --> FIXED: reuse the active-filtered total.

#### Iteration 2 (Opus)
- [BLOCKER] the Projects badge only updated in paintProjects(), which the projects poll skips while
  the panel is hidden, so it froze cross-tab (defeats a nav badge) --> FIXED: Angel added
  counts.projectsUnread to the always-polled /api/status (#3219, merged 4ea402694); wired the badge
  into tick() from that field.
- [WARNING] failure paths left badges stale --> FIXED: tick()'s /api/status catch withdraws both.

#### Iteration 3 (Opus)
- Zero actionable (one low self-healing WARNING + NITs, documented).

#### Iteration 4 (Sonnet)
- [WARNING] .navbadge had NO dark-mode override while every sibling unread badge swaps to
  #ff8c82/#0c0d0f --> FIXED: added .navbadge to both dark blocks; check gained dark arms
  (positive-control-proven).
- [WARNING] Projects open-room "staleness" --> investigated; the parked-tab deviation is invisible
  and intended (see the option-i settlement in iterations 6/8); not a defect.

#### Iteration 5 (Opus)
- CLEAN. [NIT] transient-comment direction + openUnread clamp --> FIXED (later superseded by the
  option-i comment).

#### Iteration 6 (Sonnet)
- [WARNING] the open-room subtraction's cross-cadence behavior --> this validly prompted a review of
  the design; I briefly (and wrongly) dropped the subtraction (option ii). See iteration 8.
- [CONVENTION] failure catch passed 0 not null --> FIXED (null, per setNavBadge's contract).
- [WARNING] dark check only tested the [data-theme] path, not @media --> FIXED (both paths, each
  positive-control-proven). [CONVENTION] added the // Browser-check-surface: navbadge annotation.

#### Iteration 7 (Opus)
- CLEAN. [CONVENTION] README row misdescribed the mechanism --> FIXED. [NIT] no geometry arm -->
  added a measured viewport-containment arm (self-caught + fixed a vacuous first version via its
  own positive control).

#### Iteration 8 (Sonnet)
- [BLOCKER] the dropped subtraction reimplemented option (ii), which the engine plan
  (status-projects-unread-3216.md, "agreed with Mona") explicitly REJECTED for the visible glitch
  (badge flashing a count for the room being read during the async /seen window) --> FIXED: restored
  option i (subtract the open ACTIVE room), archived-guarded. This corrected my own erroneous
  reversal of an agreed design.
- [WARNING] fragile !/openUnread/ regex arm --> replaced with a positive archived-guarded assertion.
  [NITs] vacuous vFits geometry --> dropped (viewport-only); dark page lacked a pageerror listener
  --> added; README consolidated-scope note --> added.

#### Iteration 9 (Opus)
- CLEAN. No BLOCKER/WARNING/CONVENTION. 3 NITs (a vacuous-against-this-diff pjDmTotal absence guard
  that still guards a future reintroduction; an "anymore" in a paintProjects comment; whitespace-
  exact source regexes) --> DEFERRED: all non-behavioral; chasing them would restart the loop for no
  behavior gain (moving-target discipline, bulletin a-loop-can-converge-on-a-target-you-keep-moving).

### Final Ledger
All BLOCKERs, WARNINGs, and CONVENTIONs across the 9 passes are fixed and re-verified. The Projects
design is settled on option i (agreed with Angel), the tiebreak being the documented engine plan
rather than the most recent reviewer. Post-convergence, 6j full-suite validation caught a cross-file
test-harness regression (web.offline-note.test.js lifts tick(), which now calls setNavBadge in its
catch); fixed with stub params (offline-note 12/0), the class full-suite-catches-what-a-diff-review-
cannot. Weakest premise: the source-wiring check arms are whitespace-exact (hermetic renders cannot
seed engine-derived unread), so a benign reflow of the tick() lines would red the check with no
behavior change; acceptable and documented.

Addresses #3216
