# crumb-6480: a top-level project shows its name once

Card: kosmos#6480 (noise pass on 0.7.56 staging, Josh's "keep the interface clean" theme).

## Change
- paintOneProject toggles `.pj-crumb-only` on #pj-crumb when the project has no ancestors.
- CSS hides it in today's look, keeping the back chevron:
  `:root:not([data-look="new"]) body:not(.pj-tasks-top) #pj-one-view .pj-crumb.pj-crumb-only { display: none; }`.
- Not hidden in the new look (#4470): there the crumb is the visible title and #pj-one-name is visually hidden.
- Not hidden on an upright tablet: pjPhoneOrder (#6107) moves Tasks above the heading there and now sets
  body.pj-tasks-top, so the crumb stays as the only name near the top.

## Tests
- render-subprojects-1994: the crumb is hidden today (with the chevron and the heading shown), kept in the new look,
  kept with Tasks on top; pjPhoneOrder sets and clears the class; CONTROL, a sub-project's trail is shown. 162 passed. On
  main, the hide and pjPhoneOrder arms fail in light and dark.
- mobile-shots.js: a new subproject-head screen (the control for project-head). Its shots are on the card.

## Status
- [x] Round 1 (opus): WARNING, an upright tablet lost the name above the fold --> FIXED (pj-tasks-top). NIT: the hide
  arm pins the heading --> FIXED.
- [x] Round 2 (sonnet): NO NEW FINDINGS (warnings or blockers). NITs: comment width --> FIXED. A sub-project whose parent is
  not loaded counts as top-level --> DECLINED: its crumb was its own name before too; stated in the comment.
- [ ] Validation, proof, PR, merge.
