# kosmos#8287: after a crash restart, say what was checked

The card asks for one board line after an unclean shutdown: Kosmos restarted, agents and data checked, and what if
anything was not fine.

Most of it exists. #5359 shows "This computer restarted at X. Kosmos was running and started again by itself at Y."
#7248 scans Kosmos's own files at start and names damaged ones. What is missing is the sentence saying what was
checked, so this adds one line to the #5359 note and no new notice.

## The call

- **Agents: compare against who was running when it went down.** The once-a-minute roster read also tells
  engine/restartnote.js which agents were running; the beat stores them in board-alive.json; the note keeps them. The
  note then reports only those agents. Counting "every agent on the board" would call an agent a person stopped last
  week "not back".
- **An agent gone from the roster is not counted at all.** The roster drops removed agents, so absent means removed
  since, not failed.
- **Files: the result of #7248's scan at this start, kept in the note.** Reading storecheck.current() live would read
  "fine" once a person dismissed or repaired the damage notice, and "fine" if the scan itself threw.
- **Say only what was checked.** No record of who was running (an older board's last beat, or a crash in the first
  minute): the agents clause is left out. Scan failed: the files clause is left out. Neither: no line.
- **Windows stops guessing when it can.** #5450 left Windows on the 15-minute timer. engine/win32board.js startedByTask
  already proves the logon task started this board, so that now counts as the supervisor. A box left at the sign-in
  screen past 15 minutes used to get no note at all.

## Rejected

- Claiming "crash". restartnote's header explains it: nothing can tell a crash from a person's restart, so the words
  stay "restarted". The card's example wording said crash; a false word is worse.
- A new banner. The note is already the place, and one more slot is one more thing on the board.
- Noting a board-only crash with the computer staying up. Updates and restarts relaunch through the same supervisor,
  and telling them apart needs a new stop record on three platforms. Separate card if anyone asks.
- Windows Event Log (events 41 and 6008) for a real crash verdict. Cannot be run from here.

## Weakest premise

That "running again" at the moment the page reads it is what the person wants. Agents take minutes to return, so an
early read says "not yet" and the ten-minute re-check repaints it. Also not checked: scheduled tasks, which the
reporter's box mentioned; running agents covers the agents' own jobs but nothing else.

Windows code was never run on Windows here. The new branch is one comparison, tested with injected values.

## What would change this

Someone seeing the line say "not yet" for agents that had in fact returned, or a report that a normal restart showing
this line is noise.
