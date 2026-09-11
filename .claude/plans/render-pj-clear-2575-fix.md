# Plan: fix the render-pj-clear-2575 flake blocking the 0.6.55 cut

## Problem
`docs/browser-checks/render-pj-clear-2575.js` fails intermittently (~50% idle;
measured 3 fail / 6 runs). The 0.6.55 release cut aborts at step 3b on it (failed
twice), blocking Josh's #2670 P0 connect fix.

## Diagnosis (harness, not product)
- The paint code in `web/index.html` is byte-identical to the cut's frozen sha
  (447364598534): only two unrelated commits touched web/index.html since, neither
  in the pj-question/paintThread/loadThread/openProject region.
- The product paints correctly every time: hooking `paintThread` shows it runs with
  `asking:true` and unhides `#pj-question` on every trial.
- The failure is a race in the CHECK's stub. The check seeds `PROJECTS=[p1]` by
  mutating the global and calls `openProject('p1')`, but the page's one-time startup
  `loadProjects()` (already in flight; `setInterval=0` only stops repeat polls) later
  resolves and runs `PROJECTS = body.projects || []`. `/api/projects` fell through to
  the stub catch-all (`{agents:[]}`, no `projects`), so the late resolve wiped the
  seeded p1 -> `if (!p) pjView('list'); PJ_CURRENT=null` -> the already-painted
  question re-hid. Poll-lands-before-or-after-openProject is the coin flip.

## Fix
- The stub answers the projects LIST route (`/\/api\/projects(\?|$)/`, not the
  singular `/api/project/<id>/...`) with `{ok:true, projects:[window.__project]}`.
- The seed and the stub share one `window.__project` object so they cannot drift.
- Result: every read of projects agrees, so no late startup poll can clobber the
  seed. This removes the race at its source rather than widening a timeout.

## Verification
- Before: 3 fail / 6 idle runs.
- After: 15 / 15 idle runs PASS.
- `node --check` clean.

## Why this is not "silencing a red"
The product is correct (paint proven). In production `/api/projects` returns the
real projects, which include the one being viewed, so this clobber cannot happen
live. The red was a false red from an incomplete stub; completing the stub is the
right layer.

## Out of scope
The #2575 needs-OPERATOR half (Josh's live prod verify) is unchanged; this only
fixes the committed browser-check's reliability.
