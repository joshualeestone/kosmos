# rolehereweb-5300: the person's project member list shows the role a member set for this project

Card: joshualeestone/kosmos#5300. The agents' half merged as #5355 (53e8b9242): `kosmos project role`
stores a per-project role in `project.rolesHere`, and `describe` in engine/projects.js sends it on each
member as `roleHere`, gated on `isNamedOurs` exactly like `role`. The card stays open for the person's
screen, which still showed each agent's one role.

## Change
- web/index.html, the project member row (`pj-member-role`): show `m.roleHere` when set, else `m.role`,
  through the same `roleLine(..., ROLE_TITLES)` derivation, so the capitals rule (#761) applies to both.
  A role here carries `title="Its role on this project"`.
- web.project-page.test.js: replace the literal regex pin with a test that runs the row's own expression
  (and the page's own `esc`) for: role only, role here wins, role here alone (escaped), neither.

## Decided
- Only the member row (`pjMember`), which draws both the project's member list and the project settings
  members list (`paintSettingsMembers`); both take the same project's describe rows. Other places that show an agent's role (cards, the add-member select) are the
  agent's own role on purpose: they are not about one project.
- roleHere goes through roleLine rather than shown raw, so one member list does not mix capital rules.
- The "this project" hint is only a `title` tooltip, which touch screens never show. Deliberate: the role
  text itself is the information; the hint is extra.
- No new browser check: render-project-members-3387 reads `pj-member-role` presence and passes HEADED=0.

## Verify
- `node --test web.project-page.test.js` passes; the same test fails on unmodified main at "a role here wins".
- Full `yarn test` through tools/queued-heavy.sh after review converges.
