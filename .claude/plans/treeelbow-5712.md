# treeelbow-5712: the last sub-project ends its tree line in an elbow

kosmos#5712 (Josh, 2026-10-09 14:44). On the Projects Roadmap, the nested-tree connector ran down past the last
sub-project (Frontier AI under Research & Sourcing, Northstar under Active Investment Reviews), as if it joined the
next top-level project.

## Done looks like

- The last child of each parent ends its vertical rail at its own elbow.
- Earlier siblings keep the full-height rail that runs on to the next sibling.
- A browser check measures both, and goes red if the last child's rail runs the full row.

## Decisions (reversible)

- pjTreeRows marks the last child (.pj-lastkid), and the CSS shortens that row's ::before. Rows are flat siblings,
  so no CSS selector can tell the last child of a parent.
- Scope: one rail at the row's own parent level, as before. There is still no multi-ancestor ladder at depth 2 and
  deeper.
