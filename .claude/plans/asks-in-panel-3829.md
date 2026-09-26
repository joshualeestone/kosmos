# asks-in-panel-3829

kosmos#3829 addendum (Josh, 20:00): the device-request card goes directly ABOVE the "Use Kosmos from
anywhere" panel, at the same width, in the settings column, not as a full-width top banner. On other
pages only a compact notice linking there.

1. `#plus-asks` slot before `#plus-flow`; paintAsk renders the full cards there while on Settings >
   Kosmos Plus with the connected panel showing.
2. Elsewhere `#askcard` shows one line with a Review button (`data-ask="open"`) that goes to the Plus page.
3. On the Plus page with no connected panel (not enrolled, mid sign-in) the full cards stay in the top
   card: there is no panel to sit above.
4. Live region and 44px touch targets kept; render-waiting-phone-718 asserts all three placements.
