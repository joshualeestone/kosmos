# 6.68 project-view cleanup (#3103 / #3104 / #3105)

Josh, 2026-09-15 in #chaoskosmos-design, 3 marked-up mockups (10.03.36 standard-leaf,
10.08.10 consolidated, 10.10.06 standard-parent). One branch (`projectview-cleanup-6800`),
all three cards touch the same project-view code in `web/index.html`. Built verbatim from
the mockups (josh-approved-designs-built-verbatim). STAGING: build PR-ready, HOLD the merge
until Splinter lifts the 6.68 hold (install fire is the active gate; a merge triggers Baron's cut).

## What the mockups actually show (authoritative over my summary)
- Mockup 1 (standard, leaf project "Kosmos Self Improving"): breadcrumb "< Kosmos Inside
  Out/Kosmos Self Improving" is CIRCLED at the top of the centre/dialogue column, red arrow
  points it UP-and-LEFT out of that column. Project name H2 stays. No subprojects here (leaf).
- Mockup 2 (CONSOLIDATED "Kosmos Inside Out"): left PROJECTS rail rows have their
  "7 agents / Nothing running / 3 sub projects" sub-lines STRUCK OUT (titles only);
  "Show archived projects (1)" is underlined (shrink + un-underline). Centre area: breadcrumb
  "< Kosmos Inside Out" STRUCK, "3 SUB-PROJECTS" header STRUCK, all 3 subproject rows STRUCK.
- Mockup 3 (standard, parent "Kosmos Inside Out"): full-width "3 SUB PROJECTS" + 3 rows at the
  very top STRUCK OUT; breadcrumb "< Kosmos Inside Out" CIRCLED in centre column, red arrow
  moves it UP to where that struck section was.

## Current DOM (verified, current index.html)
- `#pj-one-view` >
  - `.pj3` (grid `minmax(20%) minmax(1fr) minmax(20%)`, CSS 2986): members `.pjcol` | `.pjmid`
    (middle column = `.pjmidhead` + conversation + composer) | tasks `.pjcol`.
  - `.pjmidhead` (CSS 4501/4524) = search/gear row; `placeProjectHead()` (30295) moves
    `.pjhead` (`.pj-crumbrow` [#pj-back + #pj-crumb, markup 11132] + `.pjtitle`/#pj-one-name) into it as firstChild, EVERY layout (#761).
  - `#pj-one-subprojects` (markup 11178) painted by paintOneProject 39104-39127 as
    `<h3 class="dlab">N sub-project(s)</h3>` + `.pj-subrows`; `placeSubProjects(cons)` (30316)
    puts it before `.pj3` (standard) or after `.pjmidhead` inside `.pjmid` (consolidated, #2848).
  - Delegated click handler on `#pj-one-subprojects` at 43671; `#pj-back` handler at 38789.
- Left rail (consolidated): `#pj-list` forced to list mode by `placeProjectsView(cons)` (30461);
  rows rendered by `projectCard(p, unreadable, depth, childCount)` (37227), same fn as the
  Projects TAB. Meta pieces: `.pjfaces` (agent faces + count), `.pjpill` (pjPillOf status:
  Issue/Working/Nothing running, 37172), childCount/`.pj-parent` chip (sub-project count).
- Arch toggle: `#pj-arch-toggle` button `class="linkish"` (markup 11106); `.linkish` is
  underlined link-style. `.pj-arch-wrap` CSS 2720.

## Changes (build)

### A. Remove the sub-projects section in BOTH views (#3103.1 + #3104.2)
DECISION: remove the RENDERING (never populate) AND remove the markup element + de-wire its
refs, with an absence guard, rather than leave a hidden dead element.
- paintOneProject 39104-39127: delete the `#pj-one-subprojects` population block.
- markup 11171-11178: remove the `<section id="pj-one-subprojects">` + its comment.
- placeSubProjects (30316) + its caller in showTab: remove (nothing left to place). Verify
  the showTab call site and drop it.
- delegated click handler 43671 (`#pj-one-subprojects`): remove (element gone).
- CSS keyed on `#pj-one-subprojects` (2900 .pj-subs, 4247-4253 consolidated, 4198's
  `:has(> #pj-one-subprojects...)` at 4247): remove the now-dead rules; KEEP `.pjmidhead`
  base rules. Re-check 4247's `.pjmid:has(> #pj-one-subprojects:not([hidden])) .pjmidhead`
  border-collapse rule is removed cleanly (it only mattered when subs nested under the head).
- Add an absence guard: a browser-check / test asserting `#pj-one-subprojects` is gone and no
  "sub-project" strip renders (a-deletion-ships-with-an-absence-assertion). Prove it reds on
  origin/main.
WEAKEST PREMISE: that nothing else reads `#pj-one-subprojects` or `pjPillOf` via the subrow
path. Mitigation: grep the whole file for `pj-one-subprojects`, `pj-subrow`, `placeSubProjects`,
`pj-subs` and confirm zero live refs after the edit; full node suite + browser-checks.

### B. Breadcrumb: relocate in standard, remove in consolidated (#3103.2 + #3104.1)
- Standard (tab) view: move `.pj-crumbrow` OUT of `.pjmidhead`/centre column to a full-width
  row at the TOP of `#pj-one-view` (above `.pj3`), where the removed subprojects section sat.
  Keep #pj-one-name in `.pjmidhead` (mockup 1: name stays in the centre header).
- Consolidated view: HIDE `.pj-crumbrow` entirely (redundant with the left project list).
- Implementation: a placement helper `placeCrumbRow(cons)` mirroring the place* pattern
  (idempotent, reversible), called from the same showTab chokepoint as placeSubProjects was.
  Standard: `oneView.insertBefore(crumbrow, pj3)`. Consolidated: `crumbrow.hidden = true`
  (and restore hidden=false + reparent into .pjhead for standard). New CSS for the top
  full-width crumb row (standard only).
DECISION: a placement helper, not CSS-only, because the crumb must physically leave the
middle column (a grid child) to span full width above `.pj3`; `placeProjectHead` already sets
the precedent of moving `.pjhead`.
WEAKEST PREMISE: that #pj-back's target logic + the #2928 aria still hold when the row is
reparented (they key on paintOneProject state, not DOM position, so they should). Verify the
back chevron still navigates + reads correctly in both views.

### C. Left PROJECTS rail: titles only + arch toggle (#3105)
DECISION: scope titles-only to the CONSOLIDATED LEFT RAIL via CSS, NOT to the Projects TAB.
Card says "the left-column PROJECTS list" = the consolidated rail (mockup 2). Do NOT strip
faces/status from the full Projects tab (Josh did not ask to change the tab).
- CSS under `html[data-layout="consolidated"] body.consolidated #pj-list ...`: hide
  `.pjfaces`, `.pjpill`, `.pc-t` (description), and the `.pj-parent`/childCount chip on
  `.pj-row`, so each rail row is title only. Verify class names against projectCard output.
- `#pj-arch-toggle`: much smaller font + no underline. Either override `.linkish` for
  `#pj-arch-toggle` (font-size smaller, text-decoration: none) or swap the class. Keep the
  derived count in the button (#pj-arch-wrap stays hidden when 0).
WEAKEST PREMISE: that the consolidated rail uses `#pj-list .pj-row` with those exact classes.
Mitigation: confirm the rail's rendered markup (projectCard output classes) before writing the
CSS selectors; light-mode AND dark-mode check (light-mode-hides-a-whole-class).

## Scoping / non-goals
- Projects TAB grid/list view is UNCHANGED (titles-only is consolidated-rail only).
- The projects map/org-chart is untouched.
- No engine/API change; pure presentation in web/index.html.

## Test plan
- Full node suite green (`node --test` + `yarn test:shell`).
- Browser-checks: add absence guard for the removed subprojects section + a check that the
  standard-view breadcrumb sits above .pj3 and is hidden in consolidated + the rail is
  titles-only in consolidated. WIRE in BOTH tools/browser-checks.sh AND
  KOSMOS_BC_CI_ALLOWLIST (kosmos-has-ci-on-prs-now: two wiring locations).
- Prove every new absence/position check reds on origin/main (non-vacuous).
- #980 consolidated char-window guard (web.consolidated-980.test.js): re-run; removing the
  subprojects strip changes the consolidated char count, so update the guard if it trips
  (a-comment-can-break-a-text-parsing-test / an-unscoped-dom-query-counts-other-screens).
- Challenge-loop over >=2 models until converged; write proof file. HOLD the loop until the
  install fire parks (it needs an uninterrupted frozen tree).

## Hold
Do NOT merge until Splinter confirms 6.68 is off hold. PING Splinter the second it merges green
(Baron cuts on green). Install P0 preempts this at any time.
