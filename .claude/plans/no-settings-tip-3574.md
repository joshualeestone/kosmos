# #3574 follow-up: no Settings tip (Josh 2026-09-25 07:46, via Splinter)

"remove the Settings first-visit tip entirely ('wonky and pointless'), including from the '?' menu. Other screens'
tips stay."

## Finished looks like
Opening Settings shows no tip, first visit or ever. On Settings the ? menu does not offer "Show tips for this
screen", and does not fall back to the tour there either. Every other screen's tip, the tour and the ring explainer
are unchanged.

## Decided
- Hide the ? menu's "Show tips for this screen" item on Settings. Rejected: leaving it to fall back to the tour,
  which would still be a Settings tip of sorts, and not what was asked.
- A stored 'settings' in seen is left alone: it is harmless, and clearing it would touch the tips store for nothing.

## Weakest premise
That "including from the ? menu" means the screen item, not the whole menu. The ring and tour items stay, since
they are not Settings tips.

## Verification
render-help-tips-3574:
- T9: Settings shows no tip, and none is recorded.
- T19: on Settings the ? hides the screen item. CONTROL: on the board it offers it.
- T31 covers the four remaining screens.
- T14 moved to New agent, and T20 opens New agent's tip. Both relied on the Settings tip.
