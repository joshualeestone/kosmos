# Wire render-create-made.js into the release gate (#812)

Branch `wire-create-made-812`.

## Context

Ice Cream Kitty's #826 restated `render-create-made.js` against the real 4bf7d95 ending (`#made-done` was gone, both endings now green). #812's blocked entry is unblocked; this wires it into the gate.

## What changed

`render-create-made.js` presses the REAL Create button, so it refuses to run at all without `AGENT_WORKFORCE_DRY_RUN=1` on the server AND its own explicit `--yes-dry-run` argument -- both checked by the script itself, per its own header comment. That means it needs its own dedicated board, the same shape `render-github-door` already has.

**CORRECTED (#1575).** This sentence used to justify that by saying B8 and the self-contained
loop both boot without dry-run. Both halves are false, and this is the ORIGIN of a claim that
later misled a review of #1573. B8 is booted by `boot_board`, which sets
`AGENT_WORKFORCE_DRY_RUN=1`; the self-contained loop's members set it themselves. Why the
dedicated board is actually needed is not recorded anywhere I found.

Added a new block after `render-github-door`'s: a dedicated sandboxed server (all four `AGENT_WORKFORCE_DATA/WORKERS/PROJECTS/LAUNCH` roots, `DRY_RUN=1`, first-run completed), on a newly-picked OS-chosen port (`free_port`, not one of the pre-picked `P1`-`P9`). No tmux/fake-panes env vars -- the standalone proof ran clean without them (dry run never reaches tmux), so the wiring matches exactly what was tested rather than adding untested "just in case" setup.

## Finished when

- `render-create-made` appears in a real full-gate run's "ran:" list and PASSes (18/18, matching the standalone proof).
- The rest of the suite, including `render-github-door` right before this new block, still passes.

## Proof before the write

`NODE_PATH=... HEADED=0 node docs/browser-checks/render-create-made.js http://127.0.0.1:<port> --yes-dry-run` against a hand-built sandbox (all four roots, DRY_RUN=1, first-run seeded): 18/18 passed, no page errors. Test server and temp dirs cleaned up before writing this branch's code.
