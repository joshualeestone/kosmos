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

## Consolidated list (added after review)
A blind review caught that the consolidated rail's catch-all
`.lrow > :not(.lav):not(.lname):not(.ltitle):not(.lstate) { display: none }` would hide the badge
(a direct .lrow child) entirely in consolidated view -- and that the real mechanism is that
catch-all, NOT `.lav` being overflow:visible (my first reasoning was wrong). Since consolidated is a
primary view, the badge must show there too: the catch-all now carries `:not(.dmbadge)`. The
browser-check gained a consolidated arm asserting the badge's own computed display is not `none`
(the precise guard for the exemption) with a no-unread control.

## Deferred
- Two early commits on this branch carry the subject `backcrumb: #2863 ...` (the branch name of
  an unrelated card, #2928, carried over by mistake) instead of `dmbadge-list-org-2863 -- ...`.
  Deferred: interactive rebase is unavailable in this environment, and this branch squash-merges,
  so the branch-local subjects collapse into the PR title (which is correct) and never reach main.
- In consolidated view the avatar shrinks to 24px at left:5px, so the list badge's `left:44px`
  (tuned for the default list's 34px avatar) floats a little right of the small avatar rather than
  on its corner. Deferred: the functional requirement (the badge SHOWS, not hidden by the catch-all)
  is met and guarded; this is a cosmetic offset for Josh's live visual pass, and the harness cannot
  establish consolidated grid geometry to verify a tweak. A consolidated-scoped `left` is a one-value
  change if he wants it snug.
- The org-node DM badge (top-left) sits near where the hover callout lands for a very long name.
  Deferred: the callout is a transient hover state, the badge is `pointer-events:none` (nothing
  un-clickable), the callout is centred while the badge is top-left, so a brush only happens on an
  unusually long name. A one-value nudge if it ever bothers anyone.

## Weakest premise
That the list badge's `left: 44px` corner offset (avatar right edge at 16px padding + 34px = 50px,
so a ~6px inward overlap) reads well at Josh's live rendering. Mitigated: the browser-check asserts
the badge is at the avatar corner and not clipped/off-row in both themes; if Josh wants it nudged,
it is a one-value CSS change.
