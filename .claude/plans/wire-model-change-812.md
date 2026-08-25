# Wire render-model-change.js into the release gate (#812)

Branch `wire-model-change-812`.

## Context

`render-model-change.js` failed standalone earlier tonight (a `#d-model` select stuck disabled). Ice Cream Kitty diagnosed it correctly (#619): since #454, the Model menu is disabled for an agent with no launch file, and the check's fixture agent had none. I confirmed the diagnosis against the actual product code before agreeing to her proposed seam. She shipped it as #832: the check now seeds a launch file under the sandboxed `AGENT_WORKFORCE_LAUNCH` dir in `create.plistFor`'s own shape, and sets its own `AGENT_WORKFORCE_DRY_RUN=1` -- making the check genuinely self-contained. Running it end to end also found a real product bug (`changeModelNow` left the dialog on "Working..." after a SUCCESSFUL model change, button hidden) which #832 also fixed.

## What changed

Added `render-model-change` to the existing self-contained dynamic loop, alongside `render-memory-controls` (same shape: own sandbox, own `fleet.install`, own `AGENT_WORKFORCE_DRY_RUN`, requires `server.js` in-process).

## Finished when

- `render-model-change` appears in a real full-gate run's "ran:" list and PASSes (9/9, matching both my own standalone run and #832's own proof).
- The rest of the loop, including `render-memory-controls`, still passes.

## Proof before the write

Standalone: 9/9 passed, no page errors -- matching Ice Cream Kitty's own #832 proof exactly.
