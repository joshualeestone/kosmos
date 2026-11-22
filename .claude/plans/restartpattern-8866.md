# restartpattern-8866: several restarts in a few days are said once (kosmos#8866)

Finished looks like: three restarts within 7 days, each of which made the board's restart note, make that note carry
one more line with the count and the dates, saying repeated restarts usually mean a hardware or driver problem; one
restart makes only today's note (control).

## Read on main (8c193f2a12-era code, unchanged here)
engine/restartnote.js makes one note per start that follows a restart while Kosmos was running (#5359), with what was
checked (#8287). Nothing joins notes: each restart overwrote the last, so a pattern was invisible.

## Built
- engine/restartnote.js: each note's boot time is kept in board-restart-history.json (at most 20, for 30 days; a boot
  already kept is not counted twice; invalid entries dropped). A note made when 3 or more fall within 7 days carries
  `pattern: { count, dates }`; current() and publicNote() pass it on, cleaned. A note re-made from the same last-alive
  time (older than the newest kept boot: no beat since) is the same restart; real restarts 10 minutes apart count as
  two (a crash loop). The history is written only after the note is.
- web/index.html: rebootPattern() adds one <small class="rpat"> line to the existing note, inside its repaint key:
  "... has restarted at least N times within a week while Kosmos was running (Nov 18, twice on Nov 20, ...)". "Within a week",
  not "in the last 7 days": the note stays up a day, so the latter could be a day stale.

## Decided
- Never "unexpectedly": the engine cannot tell a crash from a person's restart (its own header says so), so the line
  says "while Kosmos was running" and gives the hardware or driver reading only "If you did not restart it yourself".
- 3 in 7 days, the card's starting guess. The line rides the existing note (the card's "simplest"), no new notice.
- A weak premise: "the same restart read again" is told by the last-alive time alone (a note re-made from the
  same last-alive record, older than the newest kept boot). A 60 s same-boot rule was tried and removed in review: it
  rested on a claim (two real restarts cannot be that close) that a fast power cycle can break, and no test isolated it.
- The hint also excludes updates ("and it was not installing updates"): an operating system update restarts a machine
  without the person, a normal cause of several restarts in a week.
- The count is a lower bound (only restarts that made a note are kept), so the line says "at least".
- Uninstall removes the history with the other remembered-answer files (install/setup.sh; now seven).
- On a Kosmos cloud machine (round 6's NIT, taken 11-22 00:4x): the restart note shows there too, and its hardware hint
  is not the person's to act on. There the line keeps the count and dates and says "Kosmos+ runs its hardware, so it is
  not yours to fix. This note is only on your board: Kosmos+ has not been told." (Ice Cream Kitty's review: "runs it for
  you" read as if someone were already on it, and nothing reports the restarts). Rejected too: naming a way to report it,
  since I could not confirm one a cloud customer can reach from the board; if one exists, the line should name it. Rejected: hiding the line on cloud (the dates are still
  true and worth knowing); "there is nothing for you to fix" (round 8: the board cannot know the cause); pointing to a help button (I could not confirm one is reachable on a cloud board). Weakest
  premise: that Kosmos+ sees a cloud machine's restarts on its own. The words do not claim that; they only say it is
  not the person's job. The browser check sets the served meta to 1 and repaints; with the old page the arm is red.
- Weakest premise: a person who restarts their computer on purpose three times in a week gets the line; the "if you
  did not restart it yourself" clause is what keeps it true for them.

## Tests
engine/restartnote-8866.test.js (through the real atStart, sandboxed): one restart, no pattern (control); the third
within 7 days carries count 3 and the three dates, and publicNote sends them; spread over 9 days, none; the same boot
twice, counted once; patternOf alone; a damaged history file, no pattern and cleaned. Against main's restartnote.js the
two positive tests fail. docs/browser-checks/render-reboot-note-5359.js: pattern arms (three, none, damaged, same-day) at 1400
and 390 px with UTC and en-US pinned; all reboot-note checks passed on a sandboxed board.
