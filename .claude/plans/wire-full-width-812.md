# Wire render-full-width.js into the release gate (#812, first of the corrected batch)

Branch `wire-full-width-812`.

## Context

#812 claimed 27 of 46 browser checks were unwired. Cross-referencing every file in `docs/browser-checks/` against every check name referenced ANYWHERE in `tools/browser-checks.sh` (not just literal `run_one "name"` strings, which is what #811's static guard appears to count -- it misses the dynamic `for n in ...; do run_one "$n" ...; done` loop at line 334) found the real number is 15. Correction sent to Splinter/#812 before this branch.

Of the real 15, `render-full-width.js` is the one ready to wire right now: Ice Cream Kitty restated its stale assertion against Mona Lisa's current design (#778, kosmos#814) minutes ago, and it takes `KOSMOS_URL` the same way three already-wired checks in the same B8 batch do (`render-reload-toast.js`, `render-updates-stale.js`, `render-theme-toggle.js`).

## What changed

`tools/browser-checks.sh`: added `render-full-width` to the B8 batch, right after `render-theme-toggle` and before `render-offline-note` (which must stay last -- it kills the server it loads from). Added it to the `server did not boot` fallback list too, so a boot failure still names it rather than silently dropping it from the summary.

## Finished when

- `run_one "render-full-width"` appears in the batch, with the correct KOSMOS_URL/shots-dir args matching the check's own documented invocation.
- A real run of `tools/browser-checks.sh` (frozen tree, #824) shows render-full-width in the "ran:" list and PASS in its own output.
- The rest of the batch (regress-a-night through render-thread) still passes -- this is an ADD, not a restructure, so nothing else should move.

## Not in this change

The other 11 real belongs (render-fields, render-first-run, render-found-board, render-list-row, render-memory-controls, render-model-change, render-not-running, render-org-chart, render-special-purpose, render-survival, render-update-toast, click-first-run) -- batched separately per Splinter's own caution about landing too much on a tree that needs to hold still before the 05:00 cut.
