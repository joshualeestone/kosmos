# #5456: a repeating task with nobody on it shows "On a schedule", not Unassigned

## Finished looks like
- engine/tasks.js taskState: a task with a repeat rule (#4787) and nobody named on it is 'scheduled' (checked just before
  'nobody'). A repeating task with an agent stays working/assigned; a non-repeating unowned task stays 'nobody'.
- Board (web/index.html): a group "On a schedule" (after Built but waiting, before On hold; decided, overridable as #4771
  placed On hold), its own colour token (a quieter in-progress green, from existing theme tokens so dark mode follows),
  icon, and a row label "On a schedule" in the project grouping. The row's existing repeat line says when it runs.
  Its tile count is its own, so the Unassigned count leaves these out.
- engine/assigner.js pick: does not hand out a repeating task with nobody on it. A person can still give it to an agent
  by hand, and then it shows that agent. blocksGoalAsk leaves it out too (else a project whose only open task is one
  could never get a goal ask again, the #1307 trap), and the ask's webhook count no longer counts it.
- The project room's task card says "On a schedule" for such a task, matching the Tasks view (review 1).
- Copy says only what the engine knows: nobody is named; if the person's scheduler runs it nothing is needed, if an agent
  should, give it one (review 1: "a schedule runs these" was more than the engine can prove).

## Decided
- Unowned + repeating = run by a schedule outside Kosmos (taskrepeat.js: Kosmos never starts a repeating job). Rejected:
  counting it as unassigned with a note (the complaint is that it reads as ownerless work).
- Part 2 of the card (structured monitor fields) is not built here; it can be its own card.

## Weakest premise
That nobody wants an unowned repeating task handed out by the assigner. If someone does, assigning it by hand works; a
card can make it a setting.

## Tests
- engine/tasks.state-3559.test.js: scheduled / assigned / nobody for the three shapes.
- engine/assigner.test.js: the repeating task is skipped, an ordinary one beside it is picked, the same task without its
  rule is picked (controls).
- web.tasks-view-3559.test.js: the group order and label, the colour token, the row label, the project room card.
- engine/assigner.test.js also: a lone scheduled task does not stop the goal ask and is not counted as a webhook task.
- docs/browser-checks/render-onhold-4771.js: three new checks (tile count, its rows, Unassigned leaves it out, control).
- docs/browser-checks/render-tasks-view-3559.js: the pinned tile keys/labels and the consolidated tile count (now 8).
Both engine tests fail with the engine/assigner change removed (measured).
