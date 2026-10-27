# switcher-7266c: #7266 slice C, the Kosmos switcher

Card: kosmos#7266 (plan comment 6429906013, slice C). Also the product half of #7264 ("which Mac's agents am I
looking at?"). Stacked on fourtabs-7266 (slice A, not merged yet); retarget to main when A merges.

## Finished looks like

On the iPhone, the top left of Agents and of Projects names the computer whose agents and projects are shown. With
two or more computers on the account, it carries a chevron and opens a list of them, each marked online or offline,
the shown one checked. Choosing one shows that computer's agents and projects (it remembers the choice), including an
offline one, which then says it is not answering under its own name. With one computer it is the name alone.

## Steps

1. BoardLogic: `pickMac(_:remembered:chosen:)`: a chosen Mac wins while it is usable, connected or not (the person
   asked for it). `switcherRows(_:shown:)`: the usable Macs by name, each with online and shown. LogicTests for both.
2. BoardClient: publish the account's Macs from chooseMac; `showMac(address:)` drops the held session (and skips the
   kept one) and starts again on the chosen Mac. Sample mode (KOSMOS_SAMPLE_AGENTS=1) lists Studio (online) and
   Laptop (offline) so the shots show the list.
3. MacSwitcher view (in AgentsView.swift, no new file, so no pbxproj edit): the leading toolbar item on Agents and
   Projects. A SwiftUI Menu, the system's own list.
4. Verify: LogicTests, the other runners, the sim build, simulator shots (the closed and the open menu, light and
   dark), blind review, proof, PR.

## Decided

- A Menu, not a sheet: two or three computers fit a menu, and it is the platform's own control. Rejected: a sheet
  with a full list (heavier, and Settings keeps Showing as the read-only line).
- An offline computer can be chosen. Rejected: hiding or disabling it. Josh asked to see which is which, and choosing
  one shows its own "not answering" screen, which names it.
- Weakest premise: that the choice should persist across launches. It does through the existing remembered-Mac key,
  but pickMac still prefers a connected Mac over a remembered offline one at launch. Kept: on launch a working list
  beats a not-answering screen.
