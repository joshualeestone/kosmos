# chatwhite-7628: the iPhone chat's ground is the desktop's conversation ground (white, black at night)

Card: kosmos#7628 (Josh 10-30 10:21: "make the background behind the agent messages white so it matches the desktop
application").

## Measured on the desktop board (web/index.html, Chromium, light and dark), not from memory
- The conversation area: `#d-talk-box` (a DM) and `#pj-room` (a project room): rgb(255,255,255) light, rgb(0,0,0) dark.
  render-agentdm-3414.js asserts the same for the DM box.
- The page around it (`body`): rgb(250,249,247) light, rgb(12,13,15) dark, which is the phone's `Palette.ground`.
- The agent bubble (`--agent-msg`): #fbf4e4 light, #252529 dark, which the phone's `Palette.agentBubble` already is.

So the phone painted its chats in the desktop's PAGE colour, not its conversation colour. The bubble already matched.

## Change
`Palette.chatGround = pair(0xffffff, 0x000000)`, used for every surface of the DM (ChatView) and the room (RoomView)
that used `Palette.ground`: the list, the strip under the composer, the fade into it, the reply and attachment strips,
the emoji panel's backing, the loading capsule. Sheets and every other screen keep `ground`. Bubbles unchanged; the
composer box keeps its card fill and its outline, so it still reads on white.

## Decided
- "White" read literally and confirmed by measurement: the desktop's conversation ground IS white. Not the bubble
  (already the desktop's cream).
- Dark: pure black, the desktop's dark conversation ground (the card's "match the desktop's dark version").

## Weakest premise
That "the background behind the agent messages" means the conversation ground, not the bubble. The bubble already
matches the desktop exactly, so changing it would move the phone away from the desktop, against the stated reason.

## Verified
Simulator (iPhone 17 Pro, iOS 27.0), sample DM and room, light and dark: background pixels read exactly
(255,255,255) and (0,0,0). Repo readers of ios/ 82/82.

## Review ledger (2 blind rounds, converged)
- Round 1: 0B 2W 1N. W: the top bar and its fade stayed on the page colour, a seam over a white list (the desktop's DM header sits inside its white box, measured), so kosmosSolidTopBar/kosmosTopFade take a `ground:` and the chat screens pass chatGround; W: Palette.tertiary dark at 0.47 fell to ~4.44:1 on pure black, now 0.49 (~4.6 to 4.8:1). N: the composer outline on white is faint (it was already as faint on #faf9f7; kept).
- Round 2: CONVERGED, no blocker or warning. The long-press sheet keeps `ground` by design (a separate sheet, not a seam).

## Validation (after rebase on origin/main)
Simulator shots after the fix (DM and room, light and dark): top bar, list and composer strip all sample (255,255,255) and (0,0,0). Repo readers of ios/ 82/82; LogicTests 1706/1706; room 735/735.
