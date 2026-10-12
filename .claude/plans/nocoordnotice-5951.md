# nocoordnotice-5951: the person is no longer warned about two coordinators

Card kosmos#5951. Josh, 2026-10-12 09:36 CDT, on a project page with four coordinating agents: "As an end user I dont
need a warning that there are two coordinators here. lets kill that message".

## The call
- **The person never sees the notice.** Josh's decision.
- **No agent nudge is kept, because there was none.** The sentence was built by `projects.coordinatorWarning` and went
  to exactly three places: the project read's `coordinators` field and the create and add answers. The only reader of
  all three was the page. Nothing ever said it to an agent. So "keep the agents' nudge" would mean BUILDING one, which
  the card does not ask for.
- **Removed end to end**, not hidden. With the page's reader gone the field would be a value nothing reads, and the
  engine rule a sentence nobody receives.

## Change
- `web/index.html`: `pjCoordNotice`, `PJ_COORD_WARN`, the read numbering it alone used (`PJ_READ_SEQ`,
  `PJ_READ_SHOWN`), the Dismiss handler and its two listeners, the two places an add or a create armed it, and its
  term in both notice builders (the Members notice and the rail notice).
- `engine/projects.js`: `coordinatorWarning`, `roleOfMember`, `PROJECT_COORDINATOR` (the last two had no other caller),
  the `coordinators` field on the project read, and both exports.
- `server.js`: the `coordinators` key on the create answer and on the add answer.

## Rejected
- **Hide it in the page and keep the server field.** Leaves a field nothing reads, and its tests would keep pinning
  a sentence no one sees.
- **Move the sentence to the agents** (a room note when a second coordinator joins). New behaviour, not asked for.
  The #4583 finding was two Project Managers negotiating who owns the brief and the task queue by hand; that
  negotiation still happens between the agents, in the room, as it did before #4583.

## Verify
- Tests that pinned the notice now pin its absence, each with a control:
  - `engine/projects.done-4583.test.js` #5951: a project with two Project Managers, read back with both members,
    carries no `coordinators` key; the engine exports no `coordinatorWarning`.
  - `server.projects.test.js` #5951: create with two managers and a second manager joining both answer with no
    `coordinators` (controls: the project has the two members).
  - `web.project-needs-you-5688.test.js`: both notice builders are who-needs-you then the member notice, and the
    page holds none of the notice's names or words (control: the notice box is still in the page).
  - `server.test.js`, `web.project-notice-3923.test.js`, `web.projects-signed-out-718.test.js`: wiring pins and
    stand-ins updated to the two-term notice.
- Browser check `docs/browser-checks/render-project-done-4583.js`: with the add answer and the project read stubbed
  to still carry the old sentence (a board served by an older build), the person sees no notice (control: the add
  went through and the stubbed read reached the page). 23 of 23, headless.
- Mutants, each run, each red by name and restored:
  - the create answer carries `coordinators` again: red at the server #5951 test;
  - the project read carries `coordinators: null` again: red at the engine #5951 test;
  - the Members notice paints `p.coordinators` again: red at the #5688 wiring test, at `server.test.js`'s notice
    wiring test, and at the browser check's "sees no notice" line (its control stayed green).

## Weakest premise
That no agent-side reader of the sentence exists outside this repo's page. Checked by grep over the whole tree for
the function, the field and the words: the page, the engine, the server and their tests are the only hits. A
client that is not in this repo would not show up in that grep; I did not look outside it.

## What would change this
A recurrence of the #4583 finding (two managers splitting the work by hand, at a cost somebody saw). Then the nudge
belongs in the project room, addressed to the agents, never on the person's page.
