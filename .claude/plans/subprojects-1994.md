# Sub-projects UI (#1994)

Branch: `subprojects-1994`. Owner: Mona Lisa (design/content). Addresses #1994 (non-closing).
Assigned by Splinter (Josh top-10, his #4). Design was mine and is published
(installkosmos.com/design/subprojects); the data model + API are merged (#2069). This builds the UI.

## Goal / done-condition (from the card)

Josh: let a project declare a parent, "from an organizational standpoint" — folders within folders,
arbitrary depth, a TREE not a flat label. Organizational only: nothing inherits settings, agents or
access through a parent. Two views required: the Projects tab AND the consolidated view.

Done = (1) a project can name a parent and the board shows the grouping; (2) deleting a parent has a
stated/tested behaviour (engine already refuses with children); (3) a cycle is refused (engine +
UI), and a child with a missing parent renders rather than vanishing.

## What I built (web/index.html only — no engine/server change; #2069 already landed it)

1. **Set-parent control** — a "Parent project" `<select id="pjs-parent">` in the project settings
   view, after Description. `pjPaintParentSelect(p)` (called from `paintProjectSettings`, the
   editable half, never the poll-driven `paintSettingsFacts`) fills it with "Top level (none)" plus
   every active project that is not this one or one of its descendants (`pjDescendantIds` walks the
   live parent links with a visited guard). The `#pjs-save` handler carries `parent` only when it
   changed (empty selection → `null` = un-group); a parent refusal from the engine (self/cycle/gone)
   is surfaced at the field via `pjFieldBad('pjs-parent', ...)`.
2. **Nested render** — `pjTreeRows(active)` groups the active projects into a tree and emits them
   depth-first (parent immediately followed by its children, siblings keeping the chosen sort).
   `projectCard(p, unreadable, depth, childCount)` gains a depth indent (via `--pj-depth`), a
   `.child` class, a sub-project count, and a "under <parent>" chip.
3. **CSS** — the tree INDENT lives only in the wide Projects-tab list
   (`body:not(.consolidated) #pj-list:not(.asgrid)`); everywhere narrow (the asgrid grid, the
   consolidated rail) the indent is dropped and the "under <parent>" CHIP carries the relationship
   instead. This is my design's call: indent runs out of room by depth three, so the chip serves the
   consolidated view.

## Key decisions (call / rejected / weakest premise)

- **One renderer for both views**, CSS-differentiated (the file already serves the Projects tab and
  the consolidated rail from one `#pj-list`). Rejected a second renderer: it would let the two views
  drift, which is exactly what this file's history warns against.
- **Indent in the wide list, chip elsewhere** (not indent everywhere). Rejected indent-in-the-rail:
  my design rejected it (runs out of room by depth three); the consolidated rail is narrow.
- **Exclude self + descendants from the select**, mirroring the engine's cycle refusal, so the
  control can only offer a valid parent (rather than letting a person bounce off a server error).
  The engine still refuses independently; the exclusion is a courtesy + the field surfaces any
  backstop refusal.
- **Nothing vanishes**: a child whose parent is archived/deleted/dangling renders at the top level
  (and keeps its chip when the engine still knows the parent's name); a `seen` guard + a top-level
  backstop make the render safe even against a stored cycle.
- **Weakest premise:** the sub-project count and the chip both come from `p.parent`/`p.parentName`
  the engine publishes per row; if a future engine change stopped publishing `parentName`, the chip
  would silently drop (the indent would still show nesting in the tab). Keyed to the merged
  contract (engine comment at projects.js: "The #1994 UI follow-up consumes it").

## Scope boundary

Organizational display only — no inheritance, matching the ruling and #2069. There is no separate
project "organization view" (the org-chart is agents-only, off `reportsTo`); the tree lives in the
project list + the settings control, which is what the card asks for.

## Verification

- `docs/browser-checks/render-subprojects-1994.js` (headless, both themes, 64 assertions): drives
  the shipped functions against a fixture tree — nesting/depth/sub-counts/chips, orphan + archived-
  parent fallback (nothing vanishes), a stored cycle renders all rows without hanging, and the
  select excludes self+descendants+archived with a control that can return the dangerous answer.
  Registered in the runner + README.
- Full `tools/run-tests.sh` (node + shell) green.
- Challenge-loop to convergence.
