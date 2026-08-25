# project-settings-762

## What this branch is

Josh's design pass on the Project settings screen (#762, #chaoskosmos-design
2026-08-24 22:02 CDT): no bounding box, no horizontal rules except one, the
folder button opens what it names instead of its enclosing folder, and the
member list gets avatars, a live add flow, and a red-X remove instead of a
stretched "Remove from project" button.

## Scope

- `web/index.html`: `#pj-settings-view` markup and CSS (width/box/heading
  match `#pj-add-view`/`.dname`; hint sentences removed; Save changes
  relocated under the member list with one rule kept before Archive/Remove;
  member rows now draw through the shared `pjMember` row with a minus
  button; a doors row (Add an agent live-picker, two disabled external
  doors) added under the list; the free-agent computation factored into
  `paintFreeAgentPicker`, shared with the tab view's own picker; the
  add-a-member POST factored into `addMemberToProject`, shared likewise;
  the removal confirm factored into `openMemModal`, shared with the
  project page's own minus.
- `engine/projects.js`: `revealFolder` drops `-R` (open the folder itself,
  not its parent), reversing an earlier explicit ruling on Josh's direct
  word this time.
- `server.projects.test.js`, `engine/projects.test.js`: updated for the
  `open` (not `open -R`) reveal call.
- `server.test.js`, `web.layout-picker.test.js`, `web.project-page.test.js`:
  five tests that pinned the prior settings-row shape (a text button
  calling `dropMember` directly, one call site for the shared minus)
  updated to the new shape.

## Done when

- The page sits on the ground like New agent and New project: no bounding
  box, the heading at the project page's title size.
- No horizontal rules between sections except the one between Save changes
  and Archive/Remove.
- The Name and Description hint sentences are gone.
- One big Save changes sits at the bottom right, under the member list.
- Members carry avatars; removal is a single red-X per row with the same
  confirm modal #761 put on the project page; the three New-project doors
  sit under the list.
- "Show me where it is" opens the project's own folder.
- Unit suite green. Full `tools/browser-checks.sh` page-gate green,
  including `render-pjsettings`.
