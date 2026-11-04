# starfirst-7684: starred agents stay on top on a live update (iPhone)

Card: kosmos#7684. The one-time reset of an old saved sort (item 1) is already on main. This branch is the follow-up for
Josh's 11-03 19:00 message from his iPhone on build 33: "Also starred agents should always be on top no matter the sort".

## What finished looks like

On the iPhone's Agents list, under every sort, starred agents are above unstarred ones after a live update, not only
after a full re-sort. A logic check pins it, with a control showing that with no stars known a live update moves no row.

## Measured before building

- Desktop (web/index.html sortAgents) already puts starred first in every order and re-sorts on every repaint (#6719).
- Phone: `Board.sorted`/`agentOrder` put stars first on a full sort, but `Board.keepingOrder` (a live update) kept the
  shown order (#7034's never-move-a-row rule). Stars read after the first sort, or a starred agent that joined later,
  sat below unstarred rows until a re-sort.

## Change

`Board.keepingOrder` ends with `starredFirst(ordered, stars:)`: a stable partition, so each group (starred, unstarred)
keeps the order it was shown in. With stars nil or empty it returns the list unchanged.

## Decided

- A star moves a row on a live update. That relaxes #7034's "a live update never moves a shown row" for stars only, which
  is what Josh asked for ("always on top"). Rejected: re-sorting the whole list on each update (moves rows the reader is
  looking at for reasons other than a star).
- Weakest premise: that a starred row jumping to the top during a live update does not feel like the list jumping under
  a finger. It moves only when a star changes or a starred agent first appears, both rare.

## Tests

ios/LogicTests/main.swift: the existing keepingOrder check now expects starred first (["i", "b", "w", "z"]) and a
CONTROL with stars nil keeps the shown order. Logic suite (run.sh) and the room suite pass.
