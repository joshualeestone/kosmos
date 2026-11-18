# taskedit-8664: kosmos task edit (fix a task's title or detail after it is made)

Card: kosmos#8664 (daily feedback, one install). Night shift, Renet Tilley, routed by Splinter.

## Problem
A task's title can stop matching the work, and nothing could change it: `kosmos task` had no edit, so the wrong
title stayed the most visible thing about the task and the only fix was a note in its conversation.

## Decision (this PR: the command line; the board's task page is a second PR)
- engine/tasks.js setText(projectId, n, { sentence, detail }, { by, person }): each of title and detail is left as it
  is when not given; a detail of null or blank clears it. Checked as create checks them (title required, at most 200;
  detail at most 2000), except an over-long title is refused rather than moved into the detail. A closed task can be
  edited (correcting what it was called changes no work). A task the person wrote (added from the screen), or whose
  words the person has since changed (`textByPerson`), is refused to an identified agent with a 403: an agent does not
  rewrite what it was asked to do (review round 3). An unnamed caller is let through (review round 5): the person's
  own terminal is one, and this PR ships no edit control on the page, so refusing it would leave the person's tasks
  with no way to be fixed at all. An unnamed edit marks the words as the person's too (review round 7), so an
  identified agent cannot rewrite the person's terminal correction. An agent's edit of its own task stays its own for
  kosmos#7151's retire offers. The CLIs refuse an empty --detail (it would clear the detail silently); --clear-detail
  is the one way to clear it. Recorded in the task's activity as `edited` with the old and
  new words and who (an agent's session, or the person from the screen); an edit that changes nothing records nothing.
- server.js POST /api/project/<id>/task/<n>/text { sentence?, detail? }: the done-when route's caller rules
  (processCaller, notOnProjectRefusal), and on AGENT_TOKEN_ROUTE_PATTERNS like done-when.
- Both CLIs: `kosmos task edit <project-id> <task-number> [--title "<new>"] [--detail "<new>" | --clear-detail]`,
  each once, at least one, checked before any request. The detail keeps its lines (as `task add` sends one).
- engine/taskactphrase.js and the page's copy: "<who> changed the title from <old> to <new>" and/or "changed the
  detail" / "cleared the detail"; the detail's words stay in the activity record, not in the line (up to 2000 chars).

Rejected:
- Moving an over-long title into the detail, as create does: an edit should change exactly what it says.
- Printing the old and new detail in the activity line: it can be 2000 characters each.
- Teaching `task edit` in the agents' managed instructions now: that is a doctrine change (DOCTRINE_VERSION bump and
  fingerprints) racing #8668's; `kosmos task help` lists it. Follow-up: #8680.
- The iPhone task page's activity phraser (ios/Kosmos/TaskPageLogic.swift) gets no `edited` case here: it already
  falls back to the bare kind for others (check-reported); left for the iPhone owner. Follow-up: #8679.

## Weakest premise
That allowing edits on a closed task is harmless. It changes no work, but a closed task's title is also what a
"done" note or a built mark was written against, and the activity row is the only record of what it said then.
