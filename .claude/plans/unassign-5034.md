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
- **Clear the report** when the agent's standing report is needs_you or blocked, it NAMED this project itself
  (`read().project === id` and not `projectInferred`; review 1), and it is not an automatic permission wait. Written exactly as the person's own clear (#2575): `state: idle, by: 'operator'`, with a
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

- **Removing a whole project** does the same for every member (review 1): ids are reused name slugs, so a later
  project of the same id would inherit both. One helper, `clearLeftovers`, serves both routes.

## Weakest premise

That a needs_you/blocked which NAMED the project is still about it at the moment of the leave. A deliberate question
at an idle prompt does not re-derive on the next poll, so a wrong clear loses its words until the agent's next turn.
Mitigated by clearing only a stated attribution (an inherited one is left standing; the card filter already takes
it out of red). What would change my mind: agents routinely naming one project on a question about another.

Second: `by: 'operator'` on an agent-made removal is not literally a person. Accepted for the reason above.

## Tests

`server.leave-leftovers-5034.test.js` (7): the clear and the card leaving decision (with a before-control that the
card WAS a decision); a departed holder raising the question again does not re-red the card; controls that must NOT
clear (another project's question, an automatic wait); held posts dropped for this project and kept for another; a
repeat leave touches nothing; engine rule unchanged with no members.

Sabotage: see the review log; the CURRENT record is the last "ALL SABOTAGES RE-RUN" line (earlier runs went stale
when a later fix changed what a test depended on, review 2 W1).

Wider run: 205 files touching roomhold / waitingOnPerson / selfreport / member routes / server.js text:
3673 tests, 3623 pass, 0 fail, 50 skipped.

## Review log

- Review 1 (opus, blind): 0 B, 4 W, 4 N. W1 inherited project cleared -> only a stated one (test 8). W2 selfreport
  security comments named one operator writer -> name clearLeftovers too. W3 project removal left the same leftovers
  -> shared helper, called for every member (test 9). W4 test 1 after-check changed the screen -> same needs_you
  screen. N1 read/write race and N2 flush-restore race documented in the helper. N3 "(by an agent)" -> "(not from the
  screen)". N4 members map built once per request. Sabotage F (inherited check removed) -> test 8 red; G (delete-route
  call removed) -> test 9 red.
- Review 2 (sonnet, blind): 0 B, 2 W, 4 N. W1 (MY RECORD WAS STALE): test 4's auto wait inherited the project, so after
  review 1's inherited check it no longer needed the auto guard, and sabotage E had not been re-run -> the wait now
  names the project (fixture asserts projectInferred false). W2 project-removal cleanup ran after the tell's await, so
  a same-name project made and joined meanwhile could lose its question -> moved before the await. N1 "by the person"
  is as strong as isViaScreen -> said in the comment. N2 the members filter covers trust waits too -> said in the
  doc comment. N3 process wording untested -> test 10. N4 roomhold header sentence split.
- ALL SABOTAGES RE-RUN on a84d77183 (each against a restored tree): A no cleanup -> #1 #3 #4 #5 #8 #10 red;
  B members not passed -> #1 #2; C forgetProject no-op -> #5 #9; D same-project check gone -> #3; E auto guard gone
  -> #4; F inherited check gone -> #8; G removal-route call gone -> #9.
