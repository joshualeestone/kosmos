# taskparts-8958: who is on each part, Done and Put back, Add a part, and Choose who, on the iPhone's task page (kosmos#8958 slice B7)

## Goal
The board's part verbs (#206 step 2, tk-who) natively. Stacked on tasksubs-8958 (B6); rebased onto main as the stack lands.

## What the board does (read 2026-11-24, web/index.html tkPartPost and the tk-who handlers)
- An open part's name is the control: a menu of Nobody yet and the project's members; choosing posts
  POST .../part/<id>/who {who}. With no members: "Add an agent to this project first, then you can put them on a part."
- Each part has Done, or Put back when closed: POST .../part/<id>/close or /reopen, also on a finished task.
- "Add a part" (200 characters) and Add: POST .../parts {sentence}; an empty box sends nothing.
- After each: the project is read again, then who was told ("Told Dana.", heardSentence), or the Mac's refusal, else "we could
  not change that".
- Choose who (#7430), under the line after Take off hold: opens the picker on the open part nobody is on; with no members,
  "Add an agent to this project first, then you can put them on it."

## Call
- Choose who is a menu of the same choices, on the first open part nobody is on, where the phone said to open the board.
- On a finished task an open part's name is not a menu (the board's is): it would tell an agent about finished work, which
  the task/assign route refuses. Done, Put back and Add stay, as the board's.
- Choosing who reads the task first and sends nothing if the part closed, moved or went, or the task finished. The Mac does not
  check it, so a change between that read and the write is not seen (a server slice, if it is ever worth one).
- No answer, or a 5xx with no words, is judged by the read after it: the part as wanted is no failure; else "could not tell".
- One part write at a time, and none while Mark as done, a hold, or a Repeats or reviewer save is out (a part's Done can
  finish the task), nor they while one is.
- Weakest premise: an added part whose answer was lost is recognised by its words, so somebody else adding the same words to
  the same task in that second reads as ours. An Add that could not be told is settled by a later read, which empties the box.

## Left for B8
The hold form (Wait for, Until, Why). Then the info button goes.
