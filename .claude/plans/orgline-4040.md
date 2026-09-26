# orgline-4040: org chart wires stop at each node's edge (#4040)

## Why

Josh, 2026-09-26 16:07: "the little line that connects agents on the org chart view goes above
agent clusters avatars". The wires were never on top: the SVG sits under the node buttons. An
agent's face is an opaque disc, so a centre-to-centre wire was hidden where it crossed it (#284).
A swarm's face is its cluster, which since #3946 item 15 has no disc (`background: none`), gaps
between its circles, and rests at half strength, so the wire shows through it.

## The change

- `orgReach(agent)`: how far a node's picture reaches from its centre on its 44px node. 22px for a
  disc; a cluster is measured from its own layout (`swarmLayout`, which `swarmCircles` draws), the
  farthest circle edge from the centre, never less than 22. (A first version assumed the circles
  reach the box's corners, 32px; they sit on a ring and reach at most about 26px, so its wires
  stopped visibly short. Caught in review.)
- `orgWireEnds(...)`: a wire cut back by each end's reach. The hub is an opaque disc, so a wire from
  it starts at the centre (reach 0). Two nodes closer than their reaches together get a hidden wire
  rather than one drawn backwards across both faces.
- Both the first render and the live layout (`orgLiveSync`, which rewrites every wire each frame
  while the chart settles or is dragged) use it.

## Rejected

- Giving the cluster an opaque disc again: #3946 item 15 took it away on purpose (a round box cropped
  the corner circles), and the gaps between circles would still show a wire.
- z-order: it was never the mechanism (#284's note says so), and the card's suggested
  elementFromPoint check cannot fail for the same reason, since the nodes are already on top.

## The check

`render-swarm-ui-3564.js` S40 builds a branch (hub, a swarm, an agent under it, a swarm at the end),
waits until the branch is drawn (not the flat ring every agent starts on), and measures against what
is drawn: no visible wire comes within any cluster circle or agent disc, and every wire ends within
6px of its own node's picture. `render-org-drag.js`'s wire-end arm now expects the wire to end at
the node's edge.

## Weakest premise

The reach is the farthest circle, so a wire arriving between two circles of a sparse cluster (two
helpers, approached from above) stops short of the nearest picture by up to the gap between them.
S40's 6px gap limit is measured on the layouts the check draws, not on every helper count.
