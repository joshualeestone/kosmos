# #3339: board unread-DM badge to the right of the cell

Owner: Angel (web-properties/frontend lane; the card body is labelled "Frontend/web-properties").
Josh's 0.6.83 board feedback (9.08.53): the notification bubble sits over the top agent's NAME;
move it "to the right of their cell." Placement confirmed by Splinter (row's top-right corner,
mirroring the grid card + org node); reversible, Josh QAs pixels on 0.6.84.

## Change (web/index.html)
`.lrow > .dmbadge` moved from `top:6px; left:44px; right:auto` (over the avatar/name corner) to
`top:-6px; right:-6px; left:auto` (the row's top-right corner, the same -6px hang the grid card
and org node use). One CSS rule + its comment.

## Test/check
render-dm-badges-2863.js: its list assertion changed from atAvatarCorner (badge near the avatar's
right edge) to atRightOfCell (badge's right edge at the row's right edge AND br.left > avatar.right
= clearly off the name). Measures real geometry, can fail on the dangerous answer. The org-node and
no-unread controls are unchanged.

## Verification
- render-dm-badges-2863 passes light + dark (atRightOfCell:true for ada's 3-unread badge; controls green).
- Surface gate green (the .lrow>.dmbadge surface maps to this check, updated). web.dm-badge-2863 6/6.
- Screenshot: the standalone shot script hit a module-load error; the check's programmatic geometry
  proof (atRightOfCell) is the verification, and Josh QAs the exact pixels in-app on 0.6.84.

## Weakest premise
That the row's top-right corner is the "right of the cell" Josh meant (vs just-right-of-the-name).
Splinter confirmed the corner reading and it mirrors the other two views; reversible in one line if
Josh wants it closer to the name on his 0.6.84 QA.
