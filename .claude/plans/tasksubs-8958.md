# tasksubs-8958: Add subtask, Close them and this task, on the iPhone's task page (kosmos#8958 slice B6)

## Goal
The board's #3861 part 2 and #6501 natively. Stacked on taskundo-8958 (B5); rebased onto main as the stack lands.

## What the board does (read 2026-11-24)
- "+ Add subtask" (always, a closed task's too) opens New task with this task as Part of; a plain New task after it starts at
  None. After: "Added task 12 as a subtask." on the task page.
- "All subtasks are built. Check each one first." + "Close them and this task": closes each built subtask in number order, then
  this one, through the close route; the first refusal stops it and says which. Acts only on the state the line was shown for.
- "All subtasks done." + "Close this task" (Mark as done). With a subtask closed without running (#8301, t.subtasks.unrun):
  "All subtasks closed." and "The rest are built. Check each one first."; that subtask reads "Not run".
- None: "None yet. Break this task into smaller ones, each with its own page."

## Call
- The native New Task sheet, with Project and Part of fixed and shown (as Project is when it is picked in Tasks), its own
  draft kept by the task page, not the Tasks tab's: rejected sharing one, because a draft aimed at a project and a task would
  then open under the Tasks tab aimed at them.
- "Close this task" is left out: on the phone the line sits directly above Mark as done, which is that press.
- Weakest premise: leaving the page during "Close them and this task" loses its refusal (the board has a toast); the list says
  where it stopped when the page is opened again.

## Tests
LogicTests: the words pinned to web/index.html, the model's order, stop and guards, the fixed parent kept when it is closed or
the Tasks read is missing. A UI test: Add subtask opens New Task with
Project and Part of fixed (the sample Mac makes no tasks, so nothing is created there). Every guard mutated red.
