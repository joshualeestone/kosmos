# waitingtile-5540: a Waiting tile on the home row

Card: kosmos#5540 (needs-decision; seen on a 0.7.27 board: 7 agents, 2 Working, 3 Idle, 2 Waiting, and no tile
counted the 2). Decided under the standing rule and recorded on the card; Mona Lisa (owner of the row) told first.

## Done looks like

An agent whose card says Waiting (state `blocked`) is counted by a tile on the home row, with the card's own pause
glyph, hidden at zero, floored with unknowns, and "?" on a failed poll, placed after Idle and before Issue.

## Decision (reversible)

- Option 1, a Waiting tile, hidden at zero (the Working tile's grammar, #4736).
- Rejected: counting blocked in Issue (Issue means "needs the person", #3410/#3718; a blocked agent often waits on
  another agent); a free-text note (new grammar in a row of tiles).
- Weakest premise: the row still need not add up (Not running has no tile on purpose, #653; Paused, Sign-in,
  Restarting, Question, Can't tell have none). This answers the case reported, not "the tiles always sum".

## Verification

- server.test.js tile tests: counted, floored ("1+" with an unknown), hidden at zero, "?" and shown on a failed poll.
- docs/browser-checks/render-workchip-zero-2157.js extended (#5540 arms, chromium and webkit): wraps count and glyph,
  shown with "2" after Idle and before Issue, hidden with its glyph out of layout at zero, "?" on a failed poll: 18/18.
- render-agent-pill-3958 and render-chip-filters-3423 pass. render-not-running needs the runner's fixture board (it
  fails the same way on main when run alone); it reads Agents, Idle and the removed Not-running tile only, and its
  fixture has no blocked agent, so CI's browser-checks job runs it.
- Screenshot: scratchpad wait-shots/tiles.png (7 Agents, 2 Working, 3 Idle, 2 Waiting).

## Review log

- **Round 1 (opus):** 0 blockers, 1 warning, 6 NITs.
  - W fixed: no test held the tile hidden at a floored "0+" (a fleet with an unknown and no blocked agent); added, red by mutation (`hidden = blockedCount === 0 && !stateFloor` now fails).
  - NITs fixed: a test comment's "2+" (the fixture is "1+"); the HTML comment names CARD_ST, not "STATE_CARD"; a guide agent in the waiting fixture (never counted); a CONTROL that blocked is not counted as working.
  - N5 recorded: a blocked agent that is also crash-looping shows "Keeps stopping" on its card and is counted in Waiting (and in Issue by needsPerson). Working and Idle count the same way today; changing all three together is a separate call, not this tile's.
  - N6 recorded for the row's owner: the pause glyph is every st 'paused' card's (Paused, Sign-in isn't working, Connection lost too), so a board with a Paused card and nobody Waiting shows a pause card and no pause tile. The tile's word says which; noted on the card for Mona.
