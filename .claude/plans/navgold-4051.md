# #4051: agent-page tile outline in bright gold

## Finished looks like
On the agent page, the selected section tile (Direct Message, Profile, Instructions, AI Settings,
Advanced) and a hovered tile are outlined in the bright gold of the Post button, not the brown,
in light and dark (Windows runs the same page code). Served in a cut.

## Change
- #d-nav.dnav-boxed button.on and :not(.on):hover: border-color var(--gold-edge) -> var(--gold-bright).
  --gold-bright is the token the Post button (.btn.uprime) fills with. Fill and icon unchanged.
- render-agent-nav.js: selected and hover outlines equal the Post button's computed fill in both
  themes; a resting tile is the control.

## Decided
- Hover too: Josh named "the highlight stroke on the states for the other buttons", and hover used the
  same brown edge. Rejected: leaving hover brown, which would make a hovered tile browner than the
  selected one.
- Weakest premise: contrast. --gold-edge was chosen for the 3:1 non-text floor; the bright gold measures
  1.85:1 on the light page (9.99:1 dark). The brand owner asked for this look, so it is built; the fill
  wash and the gold icon still mark the selected tile. Recorded on the card for him.
