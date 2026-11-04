# starfirst-7684: starred agents stay on top on a live update (iPhone)

Card: kosmos#7684. The one-time reset of an old saved sort (item 1) is already on main. This branch is the follow-up for
Josh's 11-03 19:00 message from his iPhone on build 33: "Also starred agents should always be on top no matter the sort".

## What finished looks like

On the iPhone's Agents list, under every sort, starred agents are above unstarred ones after a live update, not only
after a full re-sort. A logic check pins it, with a control showing that a star naming no listed agent moves no row.

## Measured before building

- Desktop (web/index.html sortAgents) already puts starred first in every order and re-sorts on every repaint (#6719).
- Phone: `Board.sorted`/`agentOrder` put stars first on a full sort, and every star change re-sorts the whole list
  (BoardClient.showStars; a read takes new stars only with a re-sort). But `Board.keepingOrder` (a live update) adds a new
  agent at the end, so a starred agent that joined on a live update sat below every unstarred row until a re-sort.
  That newcomer is the only row this change moves. (Review 1 corrected an earlier, wrong reading that stars read after
  the first sort could also leave starred rows low.)

## Change

`Board.keepingOrder` ends with `starredFirst(ordered, stars:)`: a stable partition, so each group (starred, unstarred)
keeps the order it was shown in. With stars nil or empty it returns the list unchanged.

## Decided

- A star moves a row on a live update. That relaxes #7034's "a live update never moves a shown row" for stars only, which
  is what Josh asked for ("always on top"). Rejected: re-sorting the whole list on each update (moves rows the reader is
  looking at for reasons other than a star).
- Weakest premise: that a starred agent joining at the top during a live update, which pushes the unstarred rows down one,
  does not feel like the list jumping under a finger. A new agent appearing is rare.

## Tests

ios/LogicTests/main.swift: a shown list already starred first ([i, w]) with a starred newcomer b gives [i, b, w, z]
(the old code gives [i, w, b, z]); a CONTROL with a star naming no listed agent keeps the shown order. Logic suite (run.sh) and the room suite pass.
