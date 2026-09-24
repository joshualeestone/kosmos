# Plan: browser-check for the consolidated projects view (#3052 verify + guard)

## Context

#3052 (Josh, 6.63 testing): the CONSOLIDATED view's projects panel inherited whatever layout the Projects TAB was last left on (grid/roadmap), drawing a wide layout in the narrow consolidated column where Josh "can't see anything". The fix (`placeProjectsView`, PR #3096) gives the consolidated projects panel its OWN view — the readable list — forcing it on the way IN and restoring the tab's saved layout on the way OUT.

The fix shipped (6.67, present in served 0.6.89, content-verified). But — unlike its siblings at the same chokepoint (#2842 settings → `render-consolidated-settings-2842.js`, #3053 create → `render-consolidated-newagent-3053.js`), #3052 shipped WITHOUT a dedicated browser-check. So it had no regression guard and its parked "live-verify" could not be closed. This branch closes both: a check that verifies the behavior AND guards it.

## What "done" looks like

`docs/browser-checks/render-consolidated-projects-3052.js` exists, passes headless (14/14: 7 assertions × light/dark), is fully registered (runner loop + README + surface comment + reason-grep), and verifies:
- From a GRID tab layout (`#pj-list.asgrid`), entering consolidated forces the list (clears `asgrid`).
- From a ROADMAP tab layout (`body.pj-roadmap`), entering consolidated forces the list (clears `pj-roadmap`).
- Leaving consolidated restores the saved layout (grid → grid, roadmap → roadmap).
- The force is DISPLAY-ONLY (does not overwrite `kosmos.layout.projects`).
- CONTROL: the tab layout is confirmed set before each entry (so the assertion can fail).

## Approach (implemented)

- Modeled exactly on `render-consolidated-settings-2842.js`: a self-contained `file://` DOM check that enters/leaves the consolidated view through the shipped `showTab` chokepoint (which calls `placeProjectsView`) and sets the tab layout via `layoutApply`, no live board / no auth (headless-runnable from a launchd session via pw-runtime).
- Registered in the 4 places a browser-check needs: the runner loop in `tools/browser-checks.sh`, the README index, the `// Browser-check-surface:` comment, and the reason-grep/surface-map gate. NOT added to the CI allowlist — the sibling consolidated checks aren't in it either (it's a curated DOM-state subset for CI time budget); this runs in the full local suite.

## Decisions + rejected alternatives

- **A browser-check, not a live click-through against the running board:** the live :16180 board needs auth + real data, and only `chromium_headless_shell` is cached here (no headed). The sandboxed `file://` check is the reproducible, headless-doable verify AND a permanent guard — strictly better than a one-off live drive.
- **Rejected closing #3052 on a content-only proxy** (fix bytes present in 0.6.89): a Josh-reported behavior bug deserves a behavior verify, not a proxy. This check IS the behavior verify.
- **Covers grid + roadmap, not the retired org-chart Map:** #3276/#3279 retired the Map and moved projects to Grid+Roadmap+List, so the check reflects the current view set.

## Weakest premise

The check enters/leaves the consolidated view through the REAL entry chokepoint (`data-layout` + `showTab('projects')`, which calls `placeProjectsView` at its `cons` gate) rather than calling `placeProjectsView` directly — so an unwiring of that call (the bug class #3052/#2842/#3053 all live at) reds the check, and it asserts the chokepoint actually fired (entered + left the consolidated view). This matches the sibling `render-consolidated-settings-2842.js`, which drives the real `showTab`.

Two residual gaps, both narrower than the fix and covered elsewhere: (1) the tab layout is set via `layoutApply` rather than by clicking the view-toggle BUTTONS, so a regression wiring those buttons to `layoutApply` is a different surface this check does not cover; (2) it is a `file://` DOM/state check, so the consolidated column's pixel/geometry appearance is not verified here — that is #2282's headed-pass territory. The `// Browser-check-surface:` contract forces this check to be updated if `placeProjectsView` or the `#pj-list.asgrid` / `body.pj-roadmap` class tokens change.

## Out of scope

- The headed pixel/geometry verify of #2282's consolidated top-header (needs a console session; routed).
- #3010's win32 check integration (#3008, Homer's lane).
