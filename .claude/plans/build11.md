# build11: Mona Lisa's build 11 notes on the iPhone app (#7034, #7419, #7421)

Mona Lisa approved build 10 (10-28 02:30) with three notes to land in TestFlight build 11. This branch carries them, off main after build 10 (#7460).

## Finished looks like

- #7034: a direct message's header has a star. It is an outline, gold when the agent is starred, and tapping it saves through the same path as the Agents list's swipe.
- #7421: on Agents and on Projects, the ⇅ button looks pressed while a non-default order is on, and VoiceOver says "Sort: <order>" on both.
- #7419: while the long-press sheet is up, the person can see which message it is for, and no strip of a different grey shows under Copy text.
- Logic tests, the app typecheck and the repo tests that read Swift pass. Simulator shots in light and dark are on the cards for Mona.

## Steps

1. Header star (5f84e98690).
2. Pressed sort button and one spoken label (b52c7d9186): a shared SortButtonLabel, Board.sortButtonLabel, Board.projectSortDefault.
3. The pressed message and the sheet's ground (de311e1508).
4. Blind review rounds to convergence, simulator shots, full suite, proof, PR, merge on green, then cut TestFlight build 11 from main.

## Decided

- **The pressed message is ringed in gold, not lit above the dim.** A system sheet dims everything behind it, and nothing in the chat can be drawn above that dim. Lifting a copy of the bubble into a window above the sheet would mean a UIKit overlay window, and its position would go stale when the chat scrolls or the keyboard moves. A 2.5 pt gold ring, the same shape as the reply-jump ring (#7101), reads through the dim and needs nothing new.
  Rejected: turning the dim off at the small height (presentationBackgroundInteraction), because tapping outside would then no longer close the sheet.
  Weakest premise: that the ring is strong enough through the dim in light mode. The shots are there to check it.
- **The "pressed" look is a soft circle of the bar's tint behind the symbol, the same size either way,** so the bar does not shift when the order changes. VoiceOver hears it as selected.
- **In a project room, the long press now sits on the bubble, inside its width frame.** Before, it covered the frame's empty side too, where nothing is drawn.

## Not verified

- Nothing here has been run on a device. The simulator cannot long-press, so the ring is shown through the sample hook (KOSMOS_SAMPLE_SHEET), not a real press.
- Still owed (Mona's #7419 item 3): a shot of a reaction that is already the person's, if the sample chat has one.
