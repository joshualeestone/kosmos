# agentsfooter-7528: the iPhone Agents list loses its footer line (TestFlight build 16)

## Finished looks like

- The Agents list on the phone shows no "Models and connections are set up on your computer." line under the agents, in light and dark (simulator shots in ~/work/design-shots/kosmos-7528-footer).
- The room logic tests fail if a footer comes back (control run: the old file reds the check, 1 of 623).

## Decided

- Removed the Section's footer entirely rather than rewording it: Josh, 10-28 19:14, "we need to kill" it. The no-agents screen was already footer-free.

## Not verified

- Not run on a device.

# Also #7529: the starred star reads gold in light mode (same build 16, same Agents-list area)

## Finished looks like

- In light mode a starred star (the chat header's, and the small one beside a name) is the bright gold #E3B341 under a thin #9C741B outline, as the board's .astar.on draws it (Mona Lisa's spec on #7529). Dark mode looks as before. Shots: dm-starred and agents, light and dark, in the same folder.

## Decided

- One StarredStar view (a filled star under an outline star, same font) used at both places, so the two cannot drift. In dark both layers are #E3B341, which is exactly the old look.
- The Agents list tint and the reaction ring keep starGold (Mona Lisa: a thin ring or tint needs the contrast).

## Weakest premise

- That the outline does not close up the fill at caption2 beside a name (Mona Lisa's own caveat). Checked in the agents shot; if it reads as a brown ring, that size takes the fill alone.
