# worlds-list-ungate-3055: ungate a names-only world list so a post-switch board can't lock the user out (kosmos#3055)

## The defect (Josh, live on 0.6.64, #3055)
Switch to a new Kosmos + restart -> "board not signed in, cannot read your agents," and the
Kosmos DROPDOWN vanishes, with no way back to the original Kosmos.

## Root cause (engine half; the web switcher-render half is ICK on worldsw-lockout-3055)
The board token is PER-WORLD: `board.token` lives at each world's `store.ROOT`. On a switch the
board self-restarts (#2346) into the new world and enforces the NEW world's token, but the browser
still holds the LEFT world's token cookie -> the new board 403s the UI -> "board not signed in."
The switcher's world-list read (`GET /api/worlds`) is board-token-gated, so it 403s too, and the
switcher hides the whole dropdown on a non-ok read (`if (!res.ok) return`) -> the user is stranded
with no control to switch back.

## This branch = B (the render-unblock half). A is a separate branch.
- **B (here):** add `GET /api/worlds/names`, EXEMPT from the board-token gate, returning ONLY
  `{ worlds: [{id, name}], activeWorldId, bootedWorldId }` -- no agent data. The switcher can read it
  even on an unsigned board, so the dropdown ALWAYS renders and the user is never locked out of
  seeing/choosing their Kosmos. ICK points her switcher's list read at it (localStorage as a deeper
  net); coordinated + agreed in-thread.
- **A (my next branch, NOT here):** make the switched-to board accept the browser's LEFT-world board
  token as same-account, so `POST /api/worlds/active` (the switch-back) actually executes on an
  unsigned board. Until A lands, ICK shows an explicit "board could not sign in" state on the
  switch-back 403 (not a silent 403), and Josh's file recovery (worlds.json activeWorldId -> default)
  is the escape hatch.

## Why the exemption is safe (the security reasoning is the point)
The board-token gate (#1946) stops ANOTHER macOS account reaching the loopback board's account data.
`GET /api/worlds` and `GET /api/worlds/list` carry account data (active/booted state; agentCount +
agents + waiting), so they STAY gated. The new `/api/worlds/names` deliberately maps each world to
`{id, name}` ONLY -- never the whole `listWorlds` row (which carries `base` filesystem paths) and
never `listForPicker` (agent data). The worst a second local account learns is Kosmos NAMES + which
is active: far below #1946's threat model, and the acceptable floor for guaranteeing no lockout. The
exemption is GET/HEAD only (a POST still hits the gate).

## Changes
- `server.js`: `PUBLIC_WORLD_ROUTES` set; a distinct `exemptPublic` term in the board-token gate
  (kept separate from `exemptAgent` because the reason differs -- a low-sensitivity public read, not
  an agent-token route); the `GET /api/worlds/names` handler mapping to `{id, name}` + markers only.
- `server.board-auth-1946.test.js`: 5 arms -- the exemption serves without a token; the payload is
  strictly id+name (+ markers), no agent/base leak; and controls that `/api/worlds`, `/api/worlds/list`,
  and a POST to `/api/worlds/names` all STAY gated.

## Test / red-capability
Full board-auth suite 15/15. Red-capability verified: removing the `exemptPublic` gate term reds the
two exemption arms while the three CONTROL arms (rich routes + POST stay gated) correctly stay green.

## Weakest premise
That names-only is a low-enough sensitivity to ungate. If Kosmos NAMES are themselves considered
account-sensitive on a shared Mac, B is wrong and the answer is A alone (keep everything gated, fix
the token so the signed board serves the rich list). I judge names + anti-lockout worth the trade,
matching the existing report/reply exemptions; A is coming regardless and makes B a defense-in-depth
net rather than the sole fix.
