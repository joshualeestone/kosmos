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
  `pattern: { count, dates }`; current() and publicNote() pass it on, cleaned. A boot within 15 minutes of a kept one
  is the same restart read again (boot times come from two clocks). The history is written only after the note is.
- web/index.html: rebootPattern() adds one <small class="rpat"> line to the existing note, inside its repaint key:
  "... has restarted N times within a week while Kosmos was running (Nov 18, Nov 20 (twice), ...)". "Within a week",
  not "in the last 7 days": the note stays up a day, so the latter could be a day stale.

## Decided
- Never "unexpectedly": the engine cannot tell a crash from a person's restart (its own header says so), so the line
  says "while Kosmos was running" and gives the hardware or driver reading only "If you did not restart it yourself".
- 3 in 7 days, the card's starting guess. The line rides the existing note (the card's "simplest"), no new notice.
- Weakest premise: a person who restarts their computer on purpose three times in a week gets the line; the "if you
  did not restart it yourself" clause is what keeps it true for them.

## Tests
engine/restartnote-8866.test.js (through the real atStart, sandboxed): one restart, no pattern (control); the third
within 7 days carries count 3 and the three dates, and publicNote sends them; spread over 9 days, none; the same boot
twice, counted once; patternOf alone; a damaged history file, no pattern and cleaned. Against main's restartnote.js the
two positive tests fail. docs/browser-checks/render-reboot-note-5359.js: pattern arms (three, none, damaged) at 1400 and
390 px; all reboot-note checks passed on a sandboxed board.
