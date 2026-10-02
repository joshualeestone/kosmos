# #5034: taking an agent off a project leaves nothing of it there

Card: kosmos#5034 (daily feedback, 2026-10-02). Branch `unassign-5034`. Owner: april (night shift).

## What was wrong (measured in the code, origin/main fc3ebe3ac)

`projects.removeAgent` drops the name from `p.agents` (plus `told`, `everSeen`, `swarmOff`) and nothing else.
Removal deliberately does not unassign task parts (projects.js "A departed assignee"). So:

1. **The red.** `tasks.waitingOnPerson` marks a task Needs Your Decision when any holder of an open part has a
   needs_you whose `stateProject` is the task's project. A departed holder still holds the part, and its
   self-report still names the project, so the old project's card stayed red with nobody on the project waiting.
2. **The report.** That needs_you/blocked report stays standing. Reported waiting states never decay (#900).
3. **The room.** `roomhold` keeps held post ids per agent PER PROJECT. Deleting an agent forgets the whole file
   (`forget`, engine/remove.js); taking it off one project did not, so its next idle flush still told it about
   posts in a room it had left. (Room reads and deliveries already derive from `p.agents`; the held list was the
   one per-project leftover found.)

## The call

In the member route (DELETE `/api/project/:id/agent/:name`), only when the leave MOVED membership:
- **Clear the report** when the agent's standing report is needs_you or blocked, the board ties it to THIS project
  (`read().project === id`, stated or carried forward, the same attribution that lit the card), and it is not an
  automatic permission wait. Written exactly as the person's own clear (#2575): `state: idle, by: 'operator'`, with a
  `because` naming the project and who took it off. It re-derives: a question still on the agent's screen comes back
  on the next poll.
- **Drop that project's held room posts** (`roomhold.forgetProject`, a `take` whose ids are discarded). Other
  projects' holds are kept.
- Both best-effort and independent; the answer carries `leftBehind: { reportCleared, heldDropped }` on a moving
  DELETE only.

And in the Tasks view, `tasks.waitingOnPerson(task, roster, members)` leaves out a holder not on the task's project
(members passed from the stored project). Omitting `members` keeps the old rule, so no other caller changes. This is
the same rule `joinTaskClaims` already applies to a departed holder's claim ("cannot be checked against this task").

## Rejected

- **A new provenance value (`by: 'kosmos'`)** for the clear. More honest for an agent-made removal, but every reader
  of `by` (roomhold.idleNow, projectview.idleExcused, class1-autohandle, status) would need review for a fourth value;
  wider than the card. The `because` says who took it off instead.
- **Unassigning the departed agent's parts.** projects.js rules removal does not unassign (the given-to record is the
  person's). Not reopened.
- **Only the display gate, no clear.** Leaves the agent's own tile red with a question about a project it left.
- **Clearing automatic permission waits too.** Those are about the agent's screen, not the project, and are re-derived
  from it anyway.

## Weakest premise

That a needs_you/blocked the board attributes to the project is ABOUT the project. An inferred attribution (the
report named no project and inherited the last one) could be a question about something else; the board already
shows it on this project's cards on the same inference, so the clear matches what the person sees. It re-derives, so
a wrong clear costs one poll, and the agent's next report raises it again. What would change my mind: a report shape
where an inherited project is routinely wrong.

Second: `by: 'operator'` on an agent-made removal is not literally a person. Accepted for the reason above.

## Tests

`server.leave-leftovers-5034.test.js` (7): the clear and the card leaving decision (with a before-control that the
card WAS a decision); a departed holder raising the question again does not re-red the card; controls that must NOT
clear (another project's question, an automatic wait); held posts dropped for this project and kept for another; a
repeat leave touches nothing; engine rule unchanged with no members.

Sabotage, each run against a restored tree (all red as expected): A no cleanup -> 4 fail; B members not passed ->
test 2 fails; C forgetProject no-op -> test 5 fails; D same-project check removed -> test 3 fails; E auto guard
removed -> test 4 fails.

Wider run: 205 files touching roomhold / waitingOnPerson / selfreport / member routes / server.js text:
3673 tests, 3623 pass, 0 fail, 50 skipped.

## Review log

(challenge loop iterations recorded below)
