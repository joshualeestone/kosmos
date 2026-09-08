# #2458: assign a PARENT project at creation (the create-page UI half)

Branch: subproj-create-ui-2458. Owner: Angel. Card: kosmos#2458 (Josh 2026-09-07): on the
Create-a-new-project page there is no option to assign a parent project; you can only set a parent
later in settings. Josh needs it AT CREATION.

## Finding: the backend is already done; only the UI was missing
- **PR #2467 (merged) wired the backend**: `server.js` reads `body.parent` on `POST /api/projects`
  ("#2458: the parent chosen on the create page (blank/absent = top-level)"), and the engine validates
  it (self-parent, missing, and cycles refused). But that PR touched no `web/index.html`.
- The Create-a-new-project page had `#pj-name`, `#pj-add-desc`, an agents picker, and the advanced
  folder route -- but **no parent selector**, so the create body never sent a `parent` (always
  top-level). #1994 had added a parent `<select>` only to project SETTINGS.
- So #2458 (filed after #2467 merged) is the create-page UI half. Backend ready, no engine change.

## Change (web/index.html only + one browser-check)
1. **Markup**: a `Parent project` `<select id="pj-add-parent">` after the Description field (blank option
   "Top level (none)" first), with a grouping-not-inheritance hint mirroring the settings selector.
2. **`pjPaintCreateParentSelect()`**: "Top level (none)" + every active (non-archived) project, none
   preselected. Simpler than the settings `pjPaintParentSelect`: a project being born has no id (no
   self to exclude) and no descendants (no cycle), so no banned set and no keep-current arm. Not run
   on the projects poll, so a mid-choice is never reset under the person.
3. **`openAddProject()`** calls it, so a fresh create resets to top-level with current options.
4. **The `#pj-create` body** sends `parent` only when non-blank -- the same absent-not-null discipline
   as folder/description (the engine refuses a missing/non-string parent; blank = top-level).
- Add-agents-at-creation already works on a normal create (`agents: PJ_ADD_AGENTS`), so a subproject
  create inherits it -- no extra work, per the card's third bullet.

## Why safe / graceful
- If `PROJECTS` has not loaded when the create page opens, the list is just "Top level (none)" and a
  parent can still be set later in settings -- an empty list degrades gracefully, never blocks creation.
- Sending `parent` absent-when-blank matches the engine's branch-on-absent contract; no `parent:null`.

## Verify
- `docs/browser-checks/render-subprojects-1994.js` gains a **Layer 3** (create-page selector), driving
  the SHIPPED `openAddProject` + `#pj-create` handler: options (Top level first, active projects,
  archived excluded), a fresh create starts top-level, a chosen parent reaches the POST body, and the
  CONTROL -- a top-level create OMITS `parent` (absent, not null). 76 passed, both themes, exit 0.
  Modifying this existing check (not a new file) satisfies the #1720 gate with no reason-grep/README bumps.
- Full `run-tests.sh`; challenge-loop; PR (merge on green). No em dashes. Target 0.6.48/launch.
