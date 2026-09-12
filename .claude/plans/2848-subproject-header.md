# 2848 sub-project view: fix the header breaking across the top

## The bug (Josh, 0.6.57 staging review)

> We've got to figure out the sub-project view because it's breaking this across the top of this thing

In the CONSOLIDATED view, when a project has a sub-project, the top of the main
panel stacked three separate bars instead of one clean header:

1. a "1 SUB-PROJECT" label,
2. the sub-project row ("Kosmos Self Improving" / "Nothing running"),
3. the project name ("Kosmos Inside Out") with the settings cog + search.

Josh wants the parent project and its sub-projects to read as one clean nested
header (a breadcrumb / nested title), not two overlapping bars.

## Root cause

The project name lives in the conversation column's header (`.pjmidhead`, moved
there by `placeProjectHead` since #761). The sub-projects strip
(`#pj-one-subprojects`, #2487) renders as a sibling ABOVE the whole `.pj3` grid.
So the strip drew above the name, inverting the reading order and making the
header look like separate bars.

## The fix (consolidated view only)

Nest the sub-projects strip directly under the project name so the two read as
one header block.

1. `placeSubProjects(consolidated)` (new): in the consolidated view it moves
   `#pj-one-subprojects` into `.pjmid` right after `.pjmidhead`; in the tab view
   it restores the strip to its original slot (before `.pj3` in `#pj-one-view`).
   Reversible and idempotent. The move is confined to a single grid cell
   (`.pjmid`), so it does not disturb the `.pj3` column ordering #2487 protected.
2. `showTab` calls it, keyed on the same `cons` flag that toggles
   `body.consolidated`, so DOM placement and the consolidated CSS never disagree.
   `showTab` is the one chokepoint that reflects the effective view (the saved
   layout AND the 960px width gate, resize included).
3. CSS (consolidated only): the header drops its own bottom rule while a visible
   strip follows, and the strip carries the rule beneath both, so the name and
   its sub-projects sit above a single line. The strip goes compact and indented
   so it reads as nested under the title, not competing with it.

## Why consolidated only

Josh flagged the consolidated view. The tab view lays the strip out above a
balanced three-column grid and does not break, and the codebase norm (quoted
in this file: "changing a screen he did not mention is how a fix becomes a
report") is to fix only what was flagged. A project with no sub-projects hides
the strip, so nothing changes for it in either view.

## Coverage

Added Layer 1e to `docs/browser-checks/render-subprojects-1994.js` (already
wired into `tools/browser-checks.sh`), driving the shipped `placeProjectHead` +
`placeSubProjects` + `paintOneProject` against a real parent/child fixture:
- CONTROL (tab): the strip stays above the grid in `#pj-one-view`.
- consolidated: the strip nests into `.pjmid`, directly after the header.
- consolidated: the strip still lists its sub-project.
- consolidated: the header drops its rule and the strip carries it (one line).
- CONTROL: a leaf project hides the strip, so the header keeps its own rule.

Proven red-capable: neutering the consolidated move reddens exactly the six
consolidated assertions (the two controls stay green). Full node suite
(`tools/run-tests.sh`) run. Screenshot captured confirming the parent name is
the clean top header with the sub-project nested beneath.

## Weakest premise

That confining the strip to `.pjmid` reads well in the tab view too if a future
change ever moves it there. Today the tab view is untouched, so this is not
exercised. If tab view later needs the nested treatment, the same
`placeSubProjects` gate is the place to branch.
