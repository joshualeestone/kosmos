# sortring-7532: no grey circle behind the iPhone sort button (TestFlight build 16)

## Finished looks like

- After picking a sort, the arrows button on Agents and Projects has no grey circle behind it, light and dark (Josh, 10-28 19:29, build 15: "Remnant grey circle after I used the sort arrows").

- The Debug sample agents (KOSMOS_SAMPLE_AGENTS=1) come in the chosen order, so a shot shows the sort (Mona Lisa found the A-to-Z shot was not alphabetical). Shots: agents-talked-* (default) and agents-name-* (A to Z), light and dark, approved by Mona Lisa. In the simulator the default order is alphabetical too: the sample agents carry no last-talked time and "last talked to" breaks ties by name.

## What it was

- Not a stuck highlight. Since #7343 / #7421 the button drew a soft circle of the accent tint (0.18) whenever the order was not the default, on purpose, so a person could see the list was not in its usual order. Josh read it as a leftover.

## Decided

- Remove the circle. A non-default order still shows in the heavier (semibold) arrows, and to VoiceOver as selected with "Sort: <order>" (unchanged).
- Rejected: a fainter circle or a different colour. Josh called the circle itself the remnant, so any circle reads the same way.

- The sample list was loaded in the default order and never re-sorted (setAgentSort returns early when the order has not changed, so a reload after it left the list unsorted). It now goes through Board.agentOrder with the chosen order, as a real status read does. Debug only.

## Weakest premise

- That Josh wants no visible sign beyond the heavier arrows. If Mona Lisa or Josh wants a clearer one, it is a one-line change to the label.

## Not verified

- Not run on a device.
