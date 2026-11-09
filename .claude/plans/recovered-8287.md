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
- **An agent missing from the roster counts as not back, unless it was removed since.** Reading missing as fine would
  hide the failure this line exists to show.
- **Up means able to work.** A rejected token, a lost connection and a crash loop are named, not counted as back.
- **The line says who came back, in the past tense.** The note records it, so stopping an agent later that day is not
  reported as a failure, and the sentence stays true while that agent is stopped.
- **Files: the result of #7248's scan at this start, kept in the note.** Reading storecheck.current() live would read
  "fine" once a person dismissed or repaired the damage notice, and "fine" if the scan itself threw. A scan that could
  not read a folder or file does not say fine either.
- **Say only what was checked.** No record of who was running (an older board's last beat, or a crash in the first
  minute): the agents clause is left out. Scan failed: the files clause is left out. Neither: no line.

## Rejected

- Claiming "crash". restartnote's header explains it: nothing can tell a crash from a person's restart, so the words
  stay "restarted". The card's example wording said crash; a false word is worse.
- A new banner. The note is already the place, and one more slot is one more thing on the board.
- Noting a board-only crash with the computer staying up. Updates and restarts relaunch through the same supervisor,
  and telling them apart needs a new stop record on three platforms. Separate card if anyone asks.
- Windows Event Log (events 41 and 6008) for a real crash verdict. Cannot be run from here.

- Counting the Windows logon task as the supervisor. Review found a double-click on Kosmos.exe starts the board through
  that same task (engine/win32handoff.js), so the marker cannot tell a person from a supervisor and the note would say
  "by itself" for a person's start. Windows keeps the 15-minute guess until its launcher can say who started the board.

## Weakest premise

That "running again" at the moment the page reads it is what the person wants. Agents take minutes to return, so an
early read says "not yet" and the ten-minute re-check repaints it. Also not checked: scheduled tasks, which the
reporter's box mentioned; running agents covers the agents' own jobs but nothing else.

On Windows the 15-minute guess stands, so a box left at the sign-in screen past it still gets no note. None of this was run on Windows.

## What would change this

Someone seeing the line say "not yet" for agents that had in fact returned, or a report that a normal restart showing
this line is noise.
