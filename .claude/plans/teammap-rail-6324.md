# teammap-rail-6324: the team map from the consolidated layout (kosmos#6324)

Built on `teammap-6103` (PigeonPete, #6103); that landed on main as e741dc4c45 (PR #6342), and this branch now sits on main.

## The call (the card leaves "where the control sits in the rail" to the owner)
- The control sits in the Agents rail HEAD (`#rail-agents`), directly ABOVE the rail's project notice
  (`#alist-pj-notice`, #3948): a quiet "Team map" button, and the map box under it, both inside the head.
  First built under the notice; the design shots' sample data (1280x800) then showed a 638px notice in a 504px head,
  and since the agents list is drawn over whatever runs past the head, the button sat under a group header and could
  not be clicked. Above the notice nothing in the head pushes it out. Trade: an open map lowers the notice (who needs
  you, #5688) by up to the map's 35vh cap. A browser arm forces the notice tall and requires the button to still be
  what a click hits (CONTROL: the button moved under it reads as buried).
- Shown only while a project is open in the consolidated layout and it has members; hidden when the agents
  column is folded (fold-a), exactly like the notice.
- Painted from `paintRailPjNotice()`, so it inherits every caller the notice already has: each poll
  (paintAgentList), a project read (loadProjects), and a layout switch (showTab).
- The map is `pjTeamMap(p, LAST)`, called, never copied. Open state is the same `PJ_TEAMMAP_OPEN` set the tab
  layout uses, per project id, so a person who opened it in one layout finds it open in the other.
- A member on the map opens its page with `openDetail(name, undefined, PJ_CURRENT)`, as the tab map does.

## Rejected
- A sheet/modal: new focus-trap surface for a read-only list.
- Painting into the centre project page: the card asks for the rail, and the centre has its own layout.
- A button on the "Project Members" group row inside `#alist`: that list is rebuilt every poll, so focus
  and open state would need rescuing on each rebuild. The head is not rebuilt.

## The trade this placement makes
While a project with members is open, the button takes its own line in the Agents head, so the agents list starts
about one button lower than the projects list beside it (as it already does whenever the notice has text), and the
button plus the map (up to 35vh) lower while the map is open. The two
rail LABELS still share a line (#3948 item 2): the browser check measures that, with a control with no project open.
If that arm ever reds, the control moves onto the label line instead. Design shots are to be taken for review.
The capped map hides its scrollbar, as #867 has every list in the agents rail do. That costs a cue: on a big team the
only sign there is more is the node cut off at the box's bottom edge. Kept for consistency with #867; the design
review may want a thin scrollbar or a fade on this one box, which is a CSS-only change.

## Weakest premise
The rail is narrow (16.6vw, at least 200px). A deep reporting tree indents 16px per level, so a 4+ level tree
squeezes the words. The browser check's fixture is a four-level chain, measured at 1280 and 960 (unfolded) wide;
not measured deeper than that.
Height: the open map is capped at 35vh and scrolls inside its own box. That nested scroll is a trade: on a big team
the map is a small scrolling box. The browser check (ten members, with a control that the map really overflows its
box) measures that the first agent row stays wholly in view, and below the map's box, at 1280x900 and 960x720, with
the project notice empty (a control asserts it). The head's grid row is `auto` in the CSS but did not grow with the
map (measured 2026-10-16: 604px with the map closed and open at 1280x900), and it does not clip, so a map taller than
the head would run down over the list rather than push it; the cap-removed controls show both. Below 1280 wide the agents column folds by default and
the map goes with it; the 960x720 arms unfold it first, as a person would.
NOT measured below 720 tall: the consolidated layout has a width floor (960) and no height floor, so on a shorter window
the button, the capped map and the label line may run past the head and over the list.
NOT covered: a long project notice plus the open map on a short window. The notice is uncapped, so that pair can run
past the head and make the page scroll, as a long notice can by itself today. A notice that runs past the head is
also drawn under the agents list on main (measured in the design shots' data: the head ends at 600px and the notice's
text runs on under the list; its one Try again button was inside the head and clickable). That predates this card and
is filed separately. Also not covered:
folding the agents column drops keyboard focus from anything in the rail head, the map included (as it does for
the notice's buttons and the rows; the fold is CSS only).
Focus: a repaint finds a focused member again by data-agent; a focused member who leaves hands focus to the Team map
button; after a switch to another project whose map is drawn differently, it goes to the button. If the focused member
was the last one, the button goes too and focus falls to the page. While the map is shown, a repaint keeps its scroll
position. Its scrollbar is hidden, as every list in the
agents rail hides its own (#867).

## Checks
- Unit (`web.teammap-rail-6324.test.js`): the rail painter, lifted from the page and called, paints the map only
  while a project is open in the consolidated layout, and empties it otherwise.
- Browser (`docs/browser-checks/render-teammap-rail-6324.js`, gated): consolidated layout, project open; the button
  shows, the map opens and closes, every member is on it, height and list-in-view at two heights, focus kept over a
  repaint, folded hides it, the open state carries to the tab layout, a member opens its page.
