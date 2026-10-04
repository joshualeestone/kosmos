# tablet-5225: a touch tablet's one-screen list: an agent's name reaches 44px

Card #5225 (from #5227's review round 2). STACKED on phone-taps (#5227), which gives .namego its 44px ::after.
HOLD: merge after Monday, after #5227.

## Done looks like
- On a touch screen in the one-screen layout (data-layout consolidated, 960px+), each agent's name in the list reaches
  44. The name's b clips its overflow for the ellipsis, which clipped the area to 16px; the b's clip box grows instead:
  padding 14px above and below and 10px left, taken back by an equal negative margin. Nothing drawn moves.
- DECIDED: the first row's area stops at the rail's "Agents" heading (.railhead .lead), which is not a control. The name
  is not raised over it, so a tap on the title never opens an agent.

## Measured (Chromium, 1366x1000, hasTouch)
- Reach: before, 0 of 3 names; after, all of them. The first row's up probe lands on the rail heading; down, left and
  right reach, and every other row reaches upward too.
- Long names keep their ellipsis; row heights and name positions are identical with and without the rule; covers 0.
- render-phone-taps-5218 tablet arm: passes; FAILS twice with the rule removed (control).
- 1024: the rail is folded (no names shown); not measured there.
