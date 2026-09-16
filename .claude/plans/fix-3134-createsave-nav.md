# Plan: #3134 - Create Project + Save Changes should return to the project/list (6.68)

## The ask (Josh, 6.68)
1. After hitting "Create Project", return to the projects list / the view I was on. Currently stuck on the create-project view.
2. After "Save Changes" in project settings, return to that project. Currently stuck on settings.

Lane split with Mona (design owner): #3134 + #3127 are mine (behavioral); the rest of her backlog is hers.

## Root cause (measured, not assumed)
The project-create form is `#pj-add-view`, a `pjView` sub-view inside `#panel-projects` (NOT the
top-level agent `#panel-create`), so my first hypothesis (the create panel stays on top) was WRONG.
Measured on current main in both tab and consolidated views: after "Create project" the handler
(~43946, `openProject(newId)`, added 2026-08-11) already LEAVES the form and dives into the NEW
project's empty detail. So:
- **Create (part 1):** the real gap vs Josh's ask is the DESTINATION. Josh wants "the projects list /
  the view I was on"; current main drops him into the new project's empty detail. That empty detail is
  what he reads as being "stuck" somewhere he did not ask for.
- **Save (part 2):** the `#pjs-save` handler (~39094) deliberately calls `pjView('settings')` after a
  successful save, i.e. it STAYS on settings (this was #2923's "Saved." beside the button). Josh wants
  to return to the project.

## Approach
- **Part 1:** after a successful create, return to the projects LIST (`PJ_CURRENT = null;
  pjMarkOpen(null); pjView('list')`) instead of `openProject(newId)`. The refreshed list shows the new
  project (verified). If the create succeeded but the read-back failed (`body.project` null, only
  `body.id`), fall back to `openProject`, which surfaces its "created but we could not read it back"
  notice rather than a silent list.
- **Part 2:** after a successful save, keep #2923's "Saved." in `#pjs-save-live` (the confirmation, kept
  visible for a beat -- a description-only save has no visible effect on the detail, #2838, so the text
  confirmation matters), then AUTO-ADVANCE to the project detail (`pjView('one')`) after ~1s. The
  timeout is stored on the Save button (`btn.__navTimer`, no new global) and guarded on
  `PJ_VIEW === 'settings' && PJ_CURRENT === savedId`, so a manual navigation or opening another project
  in the meantime cancels the auto-advance and never yanks the person off a screen they moved to
  themselves. A no-op save returns before the fetch (no advance scheduled) and stays on settings; a
  read-back-failed save stays on settings and confirms in place.

### Why Option D (settings "Saved." then auto-advance) over a project-view transient
The project-detail message slots are all modal-scoped (`#pj-one-msg` lives inside the hidden
`#am-modal`) or settings-scoped (`#pj-one-msg-set`), so a clean transient ON the detail would need new
markup placed blind (no browser this session). Reusing `#pjs-save-live` (already Josh/Mona-approved via
#2923, browser-check tested) and auto-advancing after a beat confirms EVERY field type (incl. a
description-only edit) with zero new UI. Mona (design owner) endorsed a brief, self-dismissing "Saved.";
this delivers it with the navigation as the real feedback.

## Why this reading
Josh's words are explicit ("return to that project", "stuck on settings"), so #3134 supersedes #2923's
stay-in-settings confirmation. Confirmed with Mona (design owner): relocate the confirmation rather than
remove it (removal would be out of #3134's scope), brief + self-dismissing + just "Saved."

## Verification
- Part 2: `docs/browser-checks/render-pjsettings.js` save section updated -- keeps the in-flight
  spinner + #2923 "Saved." (left of button, not duplicated) assertions, then asserts the #3134
  auto-advance to `#pj-one-view` (settings hidden, rename on the project page); a no-op save stays on
  settings; no cross-project "Saved." leak.
- Part 1: new `docs/browser-checks/render-pjcreate-nav-3134.js` -- drives the shipped `#pj-create`
  handler and asserts it returns to the LIST (list shown, `#pj-one-view` + `#pj-add-view` hidden, new
  project present), with the read-back-failure fallback to `openProject`. Returns the dangerous answer
  on origin/main (which shows `#pj-one-view`).
- `render-createnav-2190.js` (AGENT create wizard) is unaffected (separate flow: create-go/cstep).
- Full validation suite + both browser-check gate libs + challenge-loop to convergence.
- No browser this session, so structural CI verification + disclosure; Josh eyeballs in-app.

## Coordination
- #3134 is disjoint from the consolidated view, so no merge-stagger with Mona is needed here (unlike
  #3127). Ships on the next cut (6.69/6.70).

## Weakest premises (both reversible, recorded for Josh's in-app review)
1. **Part 1 destination.** Current main dives into the new project's detail; I read Josh's "return to
   the projects list" literally and send him to the LIST instead. If he actually wanted to land IN the
   new project (to start adding agents), that is a one-line revert to `openProject(newProjectId)`.
2. **Part 2 auto-advance.** Auto-navigating off settings ~1s after a save assumes the person is done
   editing. Mitigated: settings has a single Save button, the advance is guarded so a manual navigation
   cancels it, and Josh asked for exactly "return to that project." If the auto-advance feels abrupt,
   the timeout is trivially tunable or removable.
