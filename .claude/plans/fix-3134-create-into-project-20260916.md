# fix-3134-create-into-project - Create Project lands inside the new project (#3134, Josh 6.70)

## The ask
Josh's 6.70 verification (2026-09-16 11:01 CDT) supersedes the 6.68 requirement:
> "once you create a project and hit Save Changes, it should take you directly into that project."

Card #3134. Owner: Mona. The 6.68 version (PR #3160) sent the user to the projects LIST after Create; Josh reversed it, so Create now lands the user INSIDE the newly-created project.

## What "finished" looks like
- After a successful "Create project", the app opens the new project's own detail view (the person is INSIDE the project), not the projects list.
- On a create that succeeds but whose read-back fails, the person still gets the honest "created but could not read it back" notice (openProject's own fallback), not a blank list.
- "Save Changes" is unchanged: it already returns to the project (`pjView('one')`), which matches the same "into that project" intent.
- Full node test suite green; a guard test pins the new create-nav behaviour to source (it flip-flopped once, 6.68 vs 6.70); the driven browser-check passes and is non-vacuous.

## The change
`web/index.html`, the `#pj-create` click handler success path:
- Was: `const created = pjById(newProjectId); if (created) { PJ_CURRENT=null; pjMarkOpen(null); pjView('list'); } else { openProject(newProjectId); }`
- Now: `openProject(newProjectId);` (a single call carrying both the read-back-OK and read-back-failed cases, the proven pre-#3160 behaviour).

## Tests
- `web.add-project.test.js`: new guard. The create handler must call `openProject(newProjectId)` and must NOT `pjView('list')`. Negative control proven (rejects the old return-to-list handler).
- `web.consolidated-980.test.js`: `pjMarkOpen(null)` close-path count 7 to 6, since the create handler is no longer a return-to-list close path (openProject carries lit-state and the read-back-failure close internally). Reasoning recorded inline.
- `docs/browser-checks/render-pjcreate-nav-3134.js`: this driven browser-check already existed (from the 6.68 PR #3160) and asserted the OLD return-to-list behaviour, so it now asserts the wrong thing and was rewritten. It asserts, in both tab and consolidated views, that after Create the new project's DETAIL is shown (`#pj-one-view` visible, `#pj-one-name` is the new project) and the create form is hidden; the tab arm also asserts the list is hidden, the consolidated arm does not (the list stays as the rail). The read-back-failure fallback arm (returns to the list with the "could not read it back" notice) is unchanged, that path is unaffected by the reversal. Ran locally via the pinned PW runtime (`NODE_PATH=$HOME/work/pw-runtime/node_modules HEADED=0`): passes on this branch, fails on the 6.68 behaviour. This also satisfies the #1720 browser-check gate for the `web/` change.

## Collision check
- Coordinated with Angel (HEADS-UP; she confirmed no overlap and released the stale night-shift claim file). She built the ORIGINAL #3134 (PR #3160); she is not on the scope-change.
- Region is the create/save routing only; clear of Renet's room-scroll-repin (dialog) and Angel's #3188/#3113.

## Weakest premise
That "take you directly into that project" means the create half should land inside the new project (the card author's reading, and it matches the save half already doing so). If Josh meant something narrower, it is a one-line revert. Building it per his words; he can undo.
