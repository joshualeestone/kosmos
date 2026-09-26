# #3948: the project notice in the consolidated layout

## Finished looks like
A person in the consolidated layout sees the same project notice (#3923), with the same rows and
Try again, above the consolidated Agents list, and a screen reader announces it.

## Plan
1. A second live region `#alist-pj-notice` (role=status, aria-live=polite, never hidden) above
   `#alist`, plus its own hidden success line `#alist-pj-notice-said`.
2. `paintAgentList()` paints it from `pjNotice(p.agents, p.id)` only when the layout is
   consolidated and a project is open; otherwise it is emptied (so the tab layout never says it
   twice). Same roster as `paintOneProject`, so the TRIED/MISSED prune agrees.
3. The Try again listener becomes one named handler `pjNoticeRetryClick`, attached to both
   notices. `currentTarget` picks the box; the rail arm repaints the rail, writes the rail's
   success line and falls back to focusing `#alist` (the Members heading is hidden there).
4. CSS: padding on the rail box only when it has content.

## Tests
- web.project-notice-3923.test.js: harness re-anchored to the named handler; new rail arm, with
  the tab-layout control. Proven red with the rail repaint removed.
- docs/browser-checks/render-projects.js: consolidated arm on the real Quarter close fixture,
  plus the tab-layout-empty control. Proven red with the rail paint blanked.

## Decided
- Placement above the Agents list, per the card's own example. Rejected: inside the list's
  members group (it repaints every poll, which would re-announce).
- Weakest premise: that `#alist` is a sensible focus fallback. It is where the rows were; if a
  reviewer shows a better target, it is one line to change.
