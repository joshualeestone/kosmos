# #4053: the Tasks tiles, option C v2 (Josh approved 2026-09-26 19:44 CDT)

## Finished looks like
On the Tasks page each of the six tiles shows a 36px tinted round badge with a 19px line icon, beside its number,
then its label below; tiles are 16px 16px 15px padded, 10px between the badge row and the label, one shared height
(min 108px). Needs Your Decision with a count is red: red bullet, red number and label (already on main) and a
red-tinted tile; at zero, and at "cannot tell", it is neutral like the others. Light and dark. A browser check pins it.

## Change
- web/index.html: TSK_ICON (one path set per tile key) and tskBadge(k); the tile painter wraps .num in
  .tsk-mkrow with the badge (both the counted and the "cannot tell" tile); CSS for the row, badge, taller tile
  and the decision tint.
- docs/browser-checks/render-tasks-view-3559.js: arms for the badge (size, icon, tint colour), the tile padding
  and shared height, and the decision tile's tint at a count and not at zero/unknown.

## Decided
- Icons and sizes verbatim from the approved v2 mock (scratchpad mock3949.js), which Josh saw.
- The badge takes the tile's own --tsk-c, so a zero or "cannot tell" Needs Your Decision gets a neutral badge,
  matching its neutral dot (Josh: "at zero, nothing to act on").
- Weakest premise: the icon glyphs themselves were my picks inside option C; Josh approved them as mocked.
