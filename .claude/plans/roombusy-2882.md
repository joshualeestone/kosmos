# roombusy-2882: scope the project room "working" indicator to its own project

## Card
kosmos#2882 (sibling of #2837). The project chat-room "...are working" indicator
(`paintRoomBusy`, `web/index.html`, #pj-busy) derived its per-project working signal from
the UNSCOPED global `state === 'working'`, so it lit an agent as working in EVERY room it is
a member of while the agent was really working in just one - the identical over-claim #2837
removed for the project-overview pill, one surface over.

## Change (web-only, collision-free with #2837)
- `paintRoomBusy(members)` -> `paintRoomBusy(members, projectId)`; the working filter becomes
  `a.state === 'working' && a.stateProject === projectId`. `stateProject` is the field #2837
  carries onto the working state, served on every agent card by `engine/status.js`, and it is
  the same id space the engine compares against `project.id` (`engine/projects.js:1060`).
- Both call sites pass the project they render: `openProject.id` (~15333) and `p.id` (~36215).
- Verified #2837's live branch (`proj-working-glow-2837`, last commit ~one minute before this
  work) touches ONLY engine files (projects.js, status.js) + tests, never `web/index.html`, so
  this web change does not collide with it.

## Decision: minimal scoping now; sole-membership fallback deferred (not reimplemented)
The card also asks to attribute an unattributed working agent (`stateProject === null`) to its
sole active project. That computation lives in `engine/projects.js` (#2837's `soleActiveMembership`,
with subtle non-archived / cannot-compute rules). Reimplementing it in the web layer is the
two-copies-of-one-fact drift this repo pays for, so it is DELIBERATELY NOT done here. Instead,
an unattributed working agent shows in NO room - the under-claim that is `paintRoomBusy`'s own
stated safe direction (see its #1150 note). Recovering those cases for the room should reuse
#2837's engine computation (exposed as a per-member flag both the overview pill and this line
read), as a follow-up once #2837 lands. This ships the reported over-claim fix cleanly without a
second copy of the attribution logic.

Weakest premise: that the under-claim on `stateProject === null` is acceptable. Bounded because
(a) it is the indicator's documented safe direction, and (b) it is recoverable by the #2837-reuse
follow-up. What would change the call: if unattributed work is so common that the room goes mostly
blank, prioritize the follow-up.

## Verification
- New browser check `docs/browser-checks/render-room-busy-scope-2882.js` (surface `pj-busy`):
  own room shows a working-in-this-project agent, another project's room does NOT (the #2882 bug),
  an unattributed working agent shows in no room. PASS headless (pw-runtime, HEADED=0).
- Positive control: reverting the filter to the unscoped `state === 'working'` makes the check
  RED (otherRoom lights + unattributed lights), confirming it catches the bug; restored -> PASS.
- Node: the 3 files referencing `paintRoomBusy` pass; the #1150 staleness harness updated to pass
  a `projectId` matching the fixture's `stateProject` (null) so it still drives the staleness branch
  (scoping is covered by the browser check). Full `web.*.test.js`: 1297/1297.
- Browser-check gate satisfied by the added top-level `docs/browser-checks/*.js`.
