# Wire render-memory-controls.js into the release gate (#812, batch 2 retry)

Branch `wire-batch2b-812`. Replaces the abandoned `wire-batch2-812`, which wired four checks (render-list-row, render-not-running, render-org-chart, render-survival) that all failed a real full-gate run because I assumed they'd work against B8's simple fixture fleet without checking what each check's own doc comment actually requires -- three of the four need a NOT-RUNNING agent or more agents than B8's two-agent fixture provides.

## What's different this time

Tested standalone FIRST, before touching `tools/browser-checks.sh` at all: `NODE_PATH=... node docs/browser-checks/render-memory-controls.js` passed clean (6/6, no page errors). `render-model-change.js` (the other self-contained candidate) FAILED standalone (`#d-model` select stuck disabled, timeout) -- so it stays unwired too, correctly caught before it could cost a cut attempt.

`render-memory-controls.js` is genuinely self-contained: its own `mktemp`-sandboxed data/workers/projects/launch dirs, its own `fleet.install`, requires `server.js` in-process rather than talking to a shared board over HTTP. Matches the existing dynamic loop's own description ("boots its own fixture server in-process and runs bare") exactly, so it joins that loop rather than the B8 batch.

## Finished when

- `render-memory-controls` appears in a real full-gate run's "ran:" list and PASSes.
- The rest of the loop (all twelve existing self-contained checks) still passes.

## Not in this change

render-model-change (fails even standalone, needs investigation of why `#d-model` stays disabled -- likely a missing account/provider setup the check doesn't self-provide), and the four checks from the abandoned batch (need real fixture work: a not-running agent seeded via a worker profile with no matching pane, and/or more agents than two).
