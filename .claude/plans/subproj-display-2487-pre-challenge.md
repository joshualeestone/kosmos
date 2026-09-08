---
pre_challenge: true
method: challenge-loop
branch: subproj-display-2487
diff_hash: 8f635d364c53891dd1891487f91d7b2975cc35856c97286af08aa24441f9ef01
validation: passed
subdir_audit: passed
timestamp: 2026-09-08T17:40:58Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (all blind, independent, alternating Sonnet / Opus reviewer models)
**Converged:** Yes (iteration 8 produced no new BLOCKER/WARNING/CONVENTION after dedup; its
one low WARNING was read against the code and deferred as a genuine non-issue)
**Total findings across the run:** 1 BLOCKER resolved in iter1, plus a de-escalating series
of WARNINGs; findings fell monotonically from a functional BLOCKER to an
arguably-intentional low cosmetic note.
**Fixed:** 6 | **Deferred:** 1 (iter8, with reasoning) | **Asked (awaiting user):** 0

Change under review: sub-project hierarchy DISPLAY (kosmos#2487). A compact ancestry line
("Kosmos > App > Mobile") with decorative depth dots on grid/rail project cards (deep chains
middle-elide visually while the full chain reaches a screen reader), plus a parent trail and
a click-to-open sub-projects section on the project detail page. New helper pjAncestry, edits
to projectCard and paintOneProject, new CSS, a node test, a browser-check.

### Per-Iteration Breakdown

#### Iteration 1 (Sonnet)
- [BLOCKER] detail sub-project rows were inert: the #pj-list click delegate is scoped to its
  container and does not reach the sibling #pj-one-view. --> FIXED: a dedicated click
  delegate on #pj-one-subprojects, plus a click-opens-row browser assertion.

#### Iteration 2 (Opus)
- [WARNING] an empty child rendered "No agents yet", contradicting the rule that a no-agents
  state is not a status. --> FIXED: empty child shows its label or nothing.

#### Iteration 3 (Sonnet)
- [WARNING] a stale delegate comment and missing hidden-branch coverage. --> FIXED: both,
  plus browser assertions for the empty-state branches.

#### Iteration 4 (Opus)
- [WARNING] .pj-subrow:hover had a light-only border with no dark override (a colour defect
  invisible in light mode). --> FIXED in the system-dark block, then the generated
  forced-dark block was resynced with tools/sync-forced-theme.js.

#### Iteration 5 (Sonnet)
- [BLOCKER] .pj-subrow.attn (the "needs you" red border) had no dark override, unlike its
  siblings; low-contrast red in dark. --> FIXED: added the dark swap and regenerated the
  forced block.
- [WARNING] the aria-hidden separator could make a screen reader concatenate names. --> FIXED:
  a visually-hidden comma so the reader hears "Kosmos, App".

#### Iteration 6 (Opus)
- [WARNING] the card middle-elide dropped the middle ancestor from the accessible signal too.
  --> FIXED: the dropped names ride along as visually-hidden text so a reader hears the full
  chain while the tile still visually elides.

#### Iteration 7 (Sonnet)
- [WARNING] the card ancestry lost the framing the old chip gave a screen reader (the detail
  trail had a "In " lead-in, the card did not). --> FIXED: matching vh "In " lead-in.
- [WARNING] the consolidated-rail CSS rule shipped with zero test coverage. --> FIXED: a
  browser-check asserting the ancestry line renders and is displayed under body.consolidated.

#### Iteration 8 (Opus)
- [WARNING] (low, DEFERRED) on a sub-row that is both .attn and hovered, the attn border wins
  over the hover border (equal specificity, attn declared later), so hovering a "needs you"
  row shows no border change. Deferred: the sibling .lrow list-row has the identical
  interaction, compact sub-rows correctly follow the .lrow pattern rather than the .pj-row
  card pattern (whose box-shadow is inappropriate for a thin row), keeping the red attn signal
  visible on hover is desirable, and cursor:pointer conveys clickability. Reviewer concurred
  "arguably intentional." No other BLOCKER/WARNING/CONVENTION found.

### Verification
- Full validation suite (validation-log.sh) PASSED on the head commit; recorded hash
  8f635d364c53 matches the diff_hash above.
- Node tests pass: web.pj-ancestry-2487.test.js (extracts the shipped pjAncestry; chains,
  dangling parent, self-loop, two-node cycle), web.desc-collapse-1198.test.js,
  web.theme.test.js (forced-dark mirrors system-dark).
- The rendered views + the click-opens-row assertion run under Playwright in CI
  (docs/browser-checks/render-subprojects-1994.js); no local Playwright in this session.
