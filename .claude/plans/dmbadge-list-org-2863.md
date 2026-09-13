# Plan: unread-DM badge on the list row + org node (#2863 residual)

## What this is
#2863 (notification bubbles + tallies) is the unread-DM signal across the Agents views. Already
shipped: the grid-card badge (#2885), the agents Messages tile (#2888), the projects Messages tile
(#2896). This branch does the two placements the card names as the remaining follow-up, using the
SAME `a.dmUnread` data (server withDmUnread, Angel #2881) and the SAME `dmBadge(a)` helper the grid
card uses:
- the **list-view** row badge, and
- the **org-node** badge.

## The two placement problems, and the chosen solutions
- **List row.** The default list avatar `.lav` is `overflow:hidden` (it clips a corner badge) and
  cannot be wrapped: the consolidated rail selects `.lrow > .lav` as a DIRECT child (grid-row
  spans, index 3262/3345/3351), so a wrapper would break those. Solution: the badge is a direct
  child of the now-`position:relative` `.lrow`, placed over the avatar's top-right corner
  (`.lrow > .dmbadge { top: 6px; left: 44px }`). The default list shows needs-you as the
  `.lrow.attn` border (the `.lwarn` glyph is `display:none` there), so the avatar's corner is free.
- **Org node.** `.onode` is positioned; its needs-you badge `.owarn` is top-right. Solution: the DM
  badge goes TOP-LEFT (`.onode .dmbadge { top:-6px; left:-6px; right:auto }`), the free corner, so
  a node that both needs you and has unread DMs shows the two on opposite corners, never stacked.

## Exact edits (web/index.html)
1. `lrow(a)` (both branches, offline + running): append `${dmBadge(a)}` as a direct `.lrow` child.
2. `paintOrg()` node markup: append `dmBadge(a)` after `(needsYou ? ONODE_WARN : '')`.
3. CSS: `.lrow { position: relative }` + `.lrow > .dmbadge {...}`; `.onode .dmbadge {...}`.

## Test / gate work
- New browser-check `docs/browser-checks/render-dm-badges-2863.js`: self-sandboxes its env,
  installs a fleet, seeds `a.dmUnread` on `LAST`, re-drives the real list (`#alist` =
  `LAST.map(lrow)`) and `paintOrg`, and asserts across BOTH themes that the badge renders, is laid
  out (not clipped by the overflow:hidden avatar), reads the seeded count, sits at the avatar
  corner (list) / top-left (org, opposite the needs-you badge), with a no-unread negative control
  on each view. Registered in `tools/browser-checks.sh` (the self-contained `for n` loop) and
  indexed in `docs/browser-checks/README.md`. Passes ALL PASS directly, both themes.
- `// Browser-check-surface: dmbadge lrow onode` declares the tokens for the #2518 surface gate.

## Done-condition
The unread-DM badge shows on the list-view row and the org-chart node (from the same dmUnread the
grid card uses), correctly placed in both, with no collision with the needs-you badge; full suite
green; CI green. #2863 stays open for any further tallies Josh names.

## Weakest premise
That the list badge's `left: 44px` corner offset (derived from the 34px avatar + 16px/12px row
padding) reads well at Josh's live rendering. Mitigated: the browser-check asserts the badge is at
the avatar corner and not clipped/off-row in both themes; if Josh wants it nudged, it is a one-value
CSS change. The consolidated list view is out of scope here (its `.lav` is overflow:visible, a
separate case); this is the default list the card named.
