# stickyowner-5678: a subtask under somebody's open task is theirs; the Assigner leaves it, and the list says so

Card: kosmos#5678 (user feedback 10-09, triaged by Splinter, routed to Angel 06:38). The Assigner (engine/assigner.js
pick) gives an idle agent "the next task nobody is on". A subtask nobody is on directly, under a parent another builder
holds, read as nobody's, so a second builder was given the same work.

## Done looks like

The Assigner never hands out a task under an open task somebody holds an open part of (any depth); `kosmos task list`
(both CLIs) names that owner on such a subtask, "(owner: X, through task N)"; tests pin the Assigner, the derivation and
both CLIs.

## Decisions (reversible)

- Ownership is the nearest OPEN ancestor with an OPEN part held (tasks.ownerIn). A finished parent owns nothing; a
  subtask with its own holder is its holder's (no owner line). Closed parts do not hold.
- The Assigner skips such a task rather than giving it to the owner: the owner holds open work (the parent), so the
  Assigner, which only feeds idle agents, would never pick them; the owner takes the subtask, or a person gives it out.
- Shown where an agent looks before starting (`kosmos task list`, from the /api/tasks rows' new ownerNames/ownerFrom).
  The page already shows the parent's holder and the child's "under task N" breadcrumb; an owner line on the page is
  a design call for Mona, noted on the card, not built here.
- Not covered: two agents who each start a subtask by hand (no Assigner) still can; the list now tells the second one
  whose it is. A hard refusal on hand assignment would block a person's deliberate choice.
- Weakest premise: the feedback says "after one builder has explicitly taken ownership". I read that as holding the
  parent; if the user's agents mark ownership some other way (a claim report naming the task, with no part held), this
  does not see it. What would change it: a report showing the second builder was given a subtask whose parent nobody held.

## Verification

- engine/assigner.test.js: no subtask or grandchild of a held parent is handed out; CONTROLS: an unheld parent's
  subtask is, a finished parent's subtask is; a parent loop cannot hang the pick. Red by mutation of the gate.
- engine/tasks.test.js: ownerIn's cases.
- cli.task-who-4887.test.js (a real board, both CLIs): the subtask row carries ownerNames/ownerFrom, both lists print
  "(owner: mara, through task N)", and the parent prints its own holder (CONTROL).
- Task, assigner, CLI, server and web task suites with the guards: 589/589.

## Review log

(filled in per round)
