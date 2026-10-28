# build11: Mona Lisa's build 11 notes on the iPhone app (#7034, #7419, #7421)

Mona Lisa approved build 10 (10-28 02:30) with three notes to land in TestFlight build 11. This branch carries them, off main after build 10 (#7460).

## Finished looks like

- #7034: a direct message's header has a star. It is an outline, gold when the agent is starred, and tapping it saves through the same path as the Agents list's swipe.
- #7421: on Agents and on Projects, the ⇅ button looks pressed while a non-default order is on, and VoiceOver says "Sort: <order>" on both.
- #7419: while the long-press sheet is up, the pressed message stays lit above the dim, and no strip of a different grey shows under Copy text.
- Logic tests, the app typecheck and the repo tests that read Swift pass. Simulator shots in light and dark are on the cards for Mona.

## Steps

1. Header star (5f84e98690).
2. Pressed sort button and one spoken label (b52c7d9186): a shared SortButtonLabel, Board.sortButtonLabel, Board.projectSortDefault.
3. The pressed message and the sheet's ground (de311e1508).
4. Blind review rounds to convergence, simulator shots, full suite, proof, PR, merge on green, then cut TestFlight build 11 from main.

## Decided

- **The pressed message stays lit above the chat's own dim** (Mona Lisa's design; my first build drew a gold ring instead, and she corrected it at 03:37). At the sheet's small height the system dim is turned off (iOS 16.4+) and the chat draws its own, with the pressed bubble cut out on its own shape. A tap on the dim closes the sheet. At full height the system dim returns, and before iOS 16.4 the old full dim stays. Mona accepted both limits.
  Rejected: a gold ring (not the design; gold is only a reaction already the person's), and lifting a copy of the bubble into a window above the sheet (its position goes stale when the chat scrolls).
  Weakest premise: that the chat's dim, which covers the content area, reads right beside an undimmed header bar. Mona judges that from the shots.
- **The "pressed" look is a soft circle of the bar's tint behind the symbol, the same size either way,** so the bar does not shift when the order changes. VoiceOver hears it as selected.
- **In a project room, the long press now sits on the bubble, inside its width frame.** Before, it covered the frame's empty side too, where nothing is drawn.

## Not verified

- Nothing here has been run on a device. The simulator cannot long-press or tap a menu, so the lit message and the open sort menu are shown through Debug sample hooks (KOSMOS_SAMPLE_SHEET, KOSMOS_SAMPLE_SORTMENU), not a real press.
- Mona's owed shots ride the same run: a reaction already the person's (KOSMOS_SAMPLE_MINE), and the sort menu open on an iPhone SE.
