# orgline-4040: org chart wires stop at each node's edge (#4040)

## Why

Josh, 2026-09-26 16:07: "the little line that connects agents on the org chart view goes above
agent clusters avatars". The wires were never on top: the SVG sits under the node buttons. An
agent's face is an opaque disc, so a centre-to-centre wire was hidden where it crossed it (#284).
A swarm's face is its cluster, which since #3946 item 15 has no disc (`background: none`), gaps
between its circles, and rests at half strength, so the wire shows through it.

## The change

- `orgReach(agent, ux, uy)`: how far along a direction from a node's centre its picture ends, on its
  44px node. 22px for a disc in any direction. For a cluster, where that ray leaves the last circle
  it crosses (`swarmLayout`, which `swarmCircles` draws); a ray passing just beside a circle (through
  the gap between two) stops level with that circle's outer edge. (Two earlier versions were wrong
  and caught in review: 32px everywhere assumed corner circles; one reach per cluster left a two-helper
  cluster's wire about 13px short from above.)
- `orgWireEnds(...)`: a wire cut back by each end's picture, measured along the wire. The hub is an opaque disc, so a wire from
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

`render-swarm-ui-3564.js` S40 builds a branch (hub, a five-helper swarm, an agent under it, a
two-helper swarm at the end, the least round cluster), waits until the branch is drawn (not the flat
ring every agent starts on), and measures against what is drawn: no visible wire comes within any
cluster circle or agent disc, and both ends of every branch wire land within 6px of their pictures.
`render-org-drag.js`'s wire-end arm now expects the wire to end at the node's edge.

## Weakest premise

A ray that grazes one circle's edge stops where it leaves that edge, which can be well inside the
cluster's outline (measured: 4 to 5px from the centre of a two-helper cluster at about 66 degrees).
The wire then runs along a circle's edge, not across a face; S40 measures the angles its branch
draws, not every angle.
