# Pre-challenge proof: subproj-display-2487 (kosmos#2487)

- method: challenge-loop (iterative blind review until convergence)
- branch: subproj-display-2487
- base: origin/main 393297026a
- head: 341a72e6
- diff_hash: 8f635d364c53891dd1891487f91d7b2975cc35856c97286af08aa24441f9ef01
- validation: passed
- converged: true
- iterations: 8
- reviewer models: alternated Sonnet / Opus across iterations (blind, no prior findings)

## What the change does
Adds sub-project hierarchy DISPLAY to the Projects views: a compact ancestry line
("Kosmos > App > Mobile") with decorative depth dots on grid/rail cards (deep chains
middle-elide visually while the full chain reaches a screen reader), plus a parent trail
and a "sub-projects" section (click-to-open child rows) on the project detail page. New
helper pjAncestry, edits to projectCard and paintOneProject, new CSS, a node test, a
browser-check. Design approved by Angel + Splinter.

## Iteration ledger (all fixed unless noted)
- iter1 (Sonnet) BLOCKER: detail sub-project rows were inert. The #pj-list click delegate
  is scoped to its container and does not reach the sibling #pj-one-view. FIXED: a dedicated
  click delegate on #pj-one-subprojects, plus a click-opens-row browser assertion.
- iter2 (Opus) WARNING: an empty child rendered "No agents yet", contradicting the rule that
  a no-agents state is not a status. FIXED: empty child shows its label or nothing.
- iter3 (Sonnet) WARNING: a stale delegate comment and missing hidden-branch coverage.
  FIXED: both, plus browser assertions for the empty-state branches.
- iter4 (Opus) WARNING: .pj-subrow:hover had a light-only border, no dark override (a colour
  defect invisible in light mode). FIXED in the system-dark block, then the generated
  forced-dark block was resynced with tools/sync-forced-theme.js.
- iter5 (Sonnet) BLOCKER: .pj-subrow.attn (the "needs you" red border) had no dark override,
  unlike its siblings; low-contrast red in dark. FIXED: added the dark swap and regenerated
  the forced block. WARNING: the aria-hidden separator could make a screen reader
  concatenate names. FIXED: a visually-hidden comma so the reader hears "Kosmos, App".
- iter6 (Opus) WARNING: the card middle-elide dropped the middle ancestor from the
  accessible signal too. FIXED: the dropped names ride along as visually-hidden text so a
  reader hears the full chain while the tile still visually elides.
- iter7 (Sonnet) WARNING: the card ancestry lost the framing the old chip gave a screen
  reader (the detail trail had a "In " lead-in, the card did not). FIXED: matching vh "In "
  lead-in. WARNING: the consolidated-rail CSS rule shipped with zero test coverage. FIXED: a
  browser-check asserting the ancestry line renders and is displayed under body.consolidated.
- iter8 (Opus) WARNING (low, DEFERRED as a genuine non-issue): on a sub-row that is both
  .attn and hovered, the attn border wins over the hover border (equal specificity, attn
  declared later), so hovering a "needs you" row shows no border change. Deferred because the
  sibling .lrow list-row has the identical interaction, compact sub-rows correctly follow the
  .lrow pattern rather than the .pj-row card pattern (whose box-shadow is inappropriate for a
  thin row), keeping the red attn signal visible on hover is desirable, and cursor:pointer
  conveys clickability. The reviewer concurred it is "arguably intentional." No other
  BLOCKER/WARNING/CONVENTION found this iteration.

## Convergence
iter8 produced zero new actionable findings (its single low WARNING was read against the
code and judged genuinely not a defect), so the loop converged. Findings de-escalated
monotonically from a BLOCKER (inert rows) to an arguably-intentional low cosmetic note.

## Verification
- Full validation suite (validation-log.sh) PASSED on the head commit; recorded hash
  8f635d364c53 matches the diff_hash above.
- Node tests pass: web.pj-ancestry-2487.test.js (extracts the shipped pjAncestry; chains,
  dangling parent, self-loop, two-node cycle), web.desc-collapse-1198.test.js,
  web.theme.test.js (13/13, forced-dark mirrors system-dark).
- The rendered views + the click-opens-row assertion run under Playwright in CI
  (docs/browser-checks/render-subprojects-1994.js); no local Playwright in this session.
