# nav-badges-tree-fit (#3216 + #3217) - Josh 6.74 investor-meeting items

## #3216 Nav notification badges (BUILT)
Josh: red unread-count badge on the Agents + Projects nav tabs, hidden at zero, matching the app's unread-badge styling. Data already exists (no new state):
- Agents = dmTotal (fleet sum of a.dmUnread, computed in tick(), same total as the #st-dm tile; excludes the open thread).
- Projects = sum of p.unread across PROJECTS (server withUnread; null=unknown->0), excluding the open project (mirrors the per-project list badge + the Agents open-thread exclusion).
Change (web/index.html): navbadge spans on the .tab[data-tab=agents/projects] buttons; setNavBadge(id,n) helper (hide at zero/null, 99+ cap) next to unreadBadge; wired in tick() (Agents) and after PROJECTS is set (Projects); .navbadge CSS (inline red #b3261e pill, white, tabular mono, hidden-at-zero). Tabs are display:none in consolidated view, so this is the tab-view nav (Josh's "the nav"); consolidated is a follow-up if he wants it there.
Test: docs/browser-checks/render-nav-badges-3216.js (hermetic) - render contract (shows/hides/caps/red/white) + data wiring by source. 12 checks pass.

## #3217 Projects tree (org-chart) view fit to one page (NOT STARTED)
Josh: the tree view overflows the right edge (Northstar Robotics clipped, horizontal scroll) on 0.6.74; "this thing still needs to fit on one page." Fix (design call): fit-to-zoom / auto-scale to container width / compact layout / wrap. Pure layout. Render is paintProjectsMap() (web/index.html ~37276). RENDER+MEASURE the overflow first, don't guess.

## Weakest premise
Count semantics: Agents badge = unread agent DMs (dmTotal), Projects badge = unread room posts (p.unread sum). These reuse the existing "unread" derivations, so the tab badges cannot drift from the per-item badges/tiles. If Josh wants different semantics (e.g. needs-you count), that's a swap of the count source.
