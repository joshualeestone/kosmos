# snavharden-5018: render-snav-head-4979's consolidated arm waits for the page before clicking Settings

## Why
On PR #5089 (the #5018 re-land) CI browser-checks went red twice in render-snav-head-4979, webkit, "consolidated view
1280px": after `#userpop-settings` was clicked, `#s-nav button[data-go="mac"]` stayed hidden for 20 s. The same arm
passes locally on the same tree (both engines, several runs on 2026-10-02/03), and the earlier webkit 1000px arm passed
in the same CI run.

## What finished looks like
The arm clicks the Settings link only once the page has applied the consolidated layout (the class its handler,
userpopSettingsGo, reads), so the click always takes the in-place path the arm is testing. The check still passes
locally, and still fails if Settings does not open.

## Change
docs/browser-checks/render-snav-head-4979.js: `waitForFunction(body.classList.contains('consolidated'))` between the
"attached" wait and the click. Nothing else.

## Decisions
- Wait on the state the handler reads, not a fixed sleep and not a retry of the click (a retry could hide a click that
  really does nothing).
- Weakest premise: the CI cause. The click can only fail to show the pills if it landed before the page's script had
  wired the link (the tab-view fallback would still show Settings). body.consolidated is set by the page's own
  startup (showTab), so waiting for it also waits for that script. Not reproduced locally; if CI still reds here
  with this wait in place, the cause is something else and this is not the fix.

## Validation
- render-snav-head-4979 passes locally with the wait (2026-10-02 23:55, exit 0).
