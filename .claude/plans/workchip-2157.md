# #2157: hide the boardbar "Working" chip at a known zero

Josh (2026-09-04): flip the Agents-tab working-count chip off when 0 agents are
working, like the light/dark toggle. Folded into Renet's liveness cluster (#2146);
render-only, no engine field (confirmed with Renet: the render already computes the
working rollup for the existing "N Working" chip).

## The change

`web/index.html`: the boardbar "Working" stat tile (the `.act` animation + the
`st-working` count) now hides at a KNOWN zero, extending the SAME "hide at zero"
grammar the alert/needs-you tile already uses (`st-attn-tile.hidden = !c.needsYou`).

- Markup: the Working `.stat` gains `id="st-working-tile"` (starts visible, so the
  default never falsely claims "none working").
- Main render: `st-working-tile.hidden = workingCount === 0 && !stateFloor`.
- Error path: `st-working-tile.hidden = false` (a failed poll shows "?" and un-hides,
  a prior known-zero tick may have hidden it).

## The honesty nuance (load-bearing)

Hide ONLY at a KNOWN zero (`!stateFloor`). When `stateFloor` is true (unknown agents
or unreadable pane lines), `tileCount(0, true)` renders "0+" and hiding would claim
"none working" on a read that cannot stand behind it -- the exact reason the failed-
poll path shows "?" rather than hiding (the code's own principle, quoted at the
`st-working = '?'` site). So a floored zero stays visible.

## Verification

- `server.test.js` (the boardbar `drive()` harness): the Working tile is hidden at a
  KNOWN zero, and STAYS SHOWN when nonzero OR floored (a `zeroKnown` fixture hides it,
  a `zeroFloor` fixture keeps it at "0+"); the failed-poll test asserts it comes BACK
  visible ("?"), unlike the alert tile which hides. `web.not-running.test.js` floor
  assertions preserved.
- Visual (pw-runtime, real boardbar markup + CSS): 0 working (known) -> row reads
  "3 Agents / 3 Idle", no Working chip; 2 working -> "5 Agents / [dots] 2 Working /
  3 Idle". Screenshots on the PR.
- Full `node --test` suite + test:shell (web/ change -> browser-check gate chain) via
  the challenge-loop.

## Rejected

- Hide on the raw count regardless of floor. It matches Renet's literal contract but
  violates the code's stated honesty rule (a floored 0 is "0+", not "none"); the alert
  tile hides on a raw definite count (needs_you), but Working has the unknown-floor
  case that needs_you does not.
