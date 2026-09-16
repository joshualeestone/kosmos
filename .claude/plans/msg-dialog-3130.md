# Plan: message dialog refinements (#3130)

## Goal / done-condition
The room message dialog (pjRoomRow / `.msg` rows, tab + consolidated) matches Josh's
6.70 spec (Screenshot 10.56.36 + refinements): agent bubble base #f9f7f1; a bubble
tail bottom-LEFT for agents / bottom-RIGHT for the person; the person's OWN post has
NO name and NO "You" (timestamp-only header); agent keeps its name. Done when a
render shows all of that in light and dark and the browser checks pass.

## Why
Josh 6.70 (2026-09-16 11:12-11:20), pinning 10.56.36 + 4 refinements. The earlier
6.68 asks (header above the bubble, bubble holds only text, avatar centered,
lowercase am/pm, no "nothing back from" line, no agent title) already shipped in
0.6.70 (verified). This card is the NEW refinements on top.

## Changes (minimal, on top of the served 6.68 work)
- `web/index.html` `--agent-msg`: #f7f4ec -> #f9f7f1 (Josh's "a bit lighter" pick).
  The per-message [data-am] variation is a color-mix of this token, so it stays a
  nudge around #f9f7f1.
- `web/index.html` `pjRoomRow`: the operator (isOp) header no longer emits the
  `<b>name</b>` -- timestamp only. An agent's header keeps its name. (The agent
  title was already dropped in 6.68.)
- `web/index.html` CSS: `.msg-bd` gets a tail via `::after` -- a rotated square nub,
  bottom-LEFT on `.msg:not(.you)` (agent, coloured --agent-msg), bottom-RIGHT on
  `.msg.you` (person, coloured --usermsg-tint), z-index -1 so its overlapping half
  tucks behind the bubble.
- `docs/browser-checks/render-room-msgbox-2806.js`: extended to assert the operator
  post has no name, the agent keeps its name, both bubbles carry a tail on the right
  side, and the agent tail is the warm cream. Light + dark.

## Symmetric alignment (refinement #4)
The existing `.msg` mirror layout (agent avatar+gap on the left, `.msg.you`
row-reverse puts avatar+gap on the right) already insets both bubbles by the same
avatar+gap distance from their respective sides, so left and right are symmetric by
construction. Removing the "You" label makes the two headers more symmetric, not
less. No extra rule added; if Josh reads any raggedness against 10.56.36 it is a
gutter nudge.

## Decisions / trade-offs
- The tail is a rotated-square nub (Josh's "hatch"), not a border triangle -- simpler
  and it always matches the bubble token. For the person's TRANSLUCENT tint the small
  overlap is a one-number nudge, flagged for Josh.
- Only the agent title and the "You" are dropped; the agent NAME stays (Josh wants
  the agent named, only the user unnamed).

## Verified
- Direct render of pjRoomRow (agent + operator), light + dark: agent bubble base
  #f9f7f1, operator no name/You, tails on the correct sides with the right colours,
  no page errors.
- render-room-msgbox-2806.js (both themes): all #2806 + new #3130 assertions pass.

## Weakest premise
Splinter verifies against the 10.56.36 image (which I cannot see); I built to the
TEXT spec. The tail geometry and any symmetry nudge are the likely in-app iteration
points, all reversible one-liners.
