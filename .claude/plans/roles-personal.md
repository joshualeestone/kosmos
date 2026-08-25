# Plan: roles-personal

Josh, #chaoskosmos-design, 2026-08-25: "I think we could also have 3-4
like personal or family type roles to inject as well in some way."
Proposed four concrete candidates rather than build from the more
tentative wording: Household Manager, Family Coordinator, Personal
Assistant, Travel Planner. He confirmed: "Family roles sound great. Let's
put that at the very bottom of the list."

## Change

Four new roles in `engine/roles.js`, all in a new group "Personal and
family", placed as the last four entries in the `ROLES` array (before
`own`, which is excluded from the menu). Group order in the picker is
first-appearance order (web/index.html builds `optgroup`s by walking the
array), so placing the group last in the array is what actually puts it
last in the UI, not a label choice alone -- pinned by a test.

- **Household Manager**: runs the home, appointments, maintenance,
  groceries, the family calendar. No caution (prepares options, never
  buys/books, stated in its own boundary bullet rather than needing a
  separate warning at pick-time -- the stakes are lower than a role that
  handles correspondence or money directly).
- **Family Coordinator**: reconciles more than one family member's
  calendar, names collisions rather than resolving them.
- **Personal Assistant**: a personal-life mirror of Executive Assistant
  / Email Assistant, kept explicitly separate from work. Caution,
  matching the EA/Email precedent (drafts only).
- **Travel Planner**: researches and drafts itineraries. Caution (never
  books, matching the money-adjacent-role precedent).

Bumped the catalogue count test from 30 to 34, and registered both new
cautioned roles' boundaries in the mechanical caution-pinning test.

Also updated `kosmos-role-catalogue.md` (the source spec, outside this
repo) with the same four entries.

## Verification

- [x] `node --test engine/roles-personal.test.js` (new): 3/3 pass,
      pinning the group, its position (last in menu order, derived from
      array order rather than asserted directly), and both cautioned
      roles' boundaries.
- [x] `node --test engine/create.test.js`: 104/104 pass, including the
      mechanical checks that every role carries a 3-6 sentence character
      section with no em dash, and that every cautioned role states its
      own boundary.
- [x] `npm test` (full suite): 0 failures.
- [x] Live verification: seeded a real server, opened the New Agent
      dialog, read the actual `#rolesel` optgroups back out of the DOM --
      confirmed "Personal and family" is the last group and its four
      roles are in the intended order. Also confirmed `pm` (Project
      Manager) being absent from the grouped list is pre-existing,
      unrelated behavior (shown separately elsewhere), not something
      this change broke.
- [x] `bash tools/browser-checks.sh` (full suite).
