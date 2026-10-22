# holdwho-6683: point agents at kosmos task hold, and say who lifts a hold

Card: kosmos#6683. Item 2 shipped in #6693 (holdnudge-6683). This branch is the follow-up from the 2026-10-22 feedback
report and Splinter's triage (comment 6345702450): an agent told to hold a task wrote "on hold" into its title, which
nothing reads, did not know `kosmos task hold` exists, and was nudged again.

## Decided
- **The nudge names the verb.** The Prompter's idle nudge already names `blocked`, `needs_you` and `project pause`; it
  now also says "Only if your person asked to hold this task: kosmos task hold <project-id> <n> (Kosmos then stops
  nudging you about it)", under the same project-id guard as the pause clause, and before it (the pause clause stays
  last, as its test pins). That is where an agent meets the problem: in the nudge about the very task.
- **Item 3, who lifts the hold.** The task page's hold hint, on a held task, says who takes it off:
  - a hold made on the screen (`onHoldByPerson`): "You put this on hold, so only you can take it off, here." The engine
    refuses anyone else (tasks.setOnHold, 403).
  - a hold made anywhere else: "put on hold outside this screen (by an agent, or with kosmos task hold), so an agent or
    you can take it off". Not "by an agent": a person's own `kosmos task hold` from a terminal is recorded the same way
    (found on 10-20), and the board cannot tell the two apart.
  - not held: the old sentence, unchanged.

## Rejected
- Reading "on hold" in a task title as a hold: a guess from free text, and it would hide work the person did not hold.
- A separate CLI hint on `kosmos task add`: the nudge is where the agent is when it matters; `kosmos task --help`
  already lists hold.

## Weakest premise
- That the reporter's install is new enough to have `kosmos task hold` (0.7.16+); the report gave no version. The
  nudge change helps every install that updates either way.

## Tests
- engine/agentnudge.test.js: the hold clause with this task's project id and number, before the pause clause; the
  existing no-id and bad-id controls now also refuse the hold clause.
- docs/browser-checks/render-onhold-4771.js: not held (control), held on the screen, held from the engine (as an
  agent's CLI does); both viewports.
