# agentlist-states-6720 - agents-list not-running + folded-rail states (Josh 6.72)

## The ask (Josh walk-through, channel 1545167231951044749)
Follow-on to #3131/#3187 (agents-list status shown as grey/green/red ground colour). Josh's 6.72 rulings:
1. not-running agent: keep the idle grey ground BUT gray the agent itself back ~50% ("it could get the idle gray background but then also itself would be 50% grayed out"), so it's distinct from plain idle and reads "click to see what's up."
2. folded/collapsed rail: "still put the color in but make it edge-to-edge behind them ... little green ones light up and little red ones light up ... leave the gray off" so the 48px strip is not a wall of grey; keep the red-! triangle.
3. needs-trust row: auto-approved / never shows on macOS -> NO-OP (Angel confirmed win32-only; deleting breaks Windows #3013). No change.
4. grid card: KEEP the status label (Josh: different view/vibe). No change.

## What "finished" looks like
- A not-running (stopped) agent row: grey ground (base .lrow, like idle) + its .lav and .lname at ~0.5 opacity; idle stays full-strength (control).
- Folded rail (fold-a): working -> green wash edge-to-edge, needs-you -> red edge-to-edge; idle + not-running -> no wash; red-! triangle over the face unchanged.
- render-agent-lines.js asserts all of the above; full node suite green.

## The change (web/index.html CSS only)
- `.lrow.off .lav, .lrow.off .lname { opacity: .5 }` (after the existing `.lrow.off .lstate` rule).
- Two `html[data-layout="consolidated"] body.consolidated.fold-a .lrow.working/.attn { background: <green>/<red> wash }` overrides after the `fold-a .lrow { background: none }` rule.

## Tests
- docs/browser-checks/render-agent-lines.js: added a `stopped` fixture (donnie); not-running arms (grey ground + ~0.5 avatar/name + idle control at 1); folded-rail arm (working=green, needs-you=red edge-to-edge; idle + not-running no wash). All pass. Also verified independently via a computed-style script.

## Collision
No open PR/branch touching the agents-list. Built on origin/main incl the merged Build A (#3205).

## Weakest premise
That the not-running dim applies to the LROW list view (the surface #3131/#3187 changed). The grid card was explicitly kept (Josh). If Josh wants the not-running dim on the grid card too, that's a small add. Building the list per his words.
