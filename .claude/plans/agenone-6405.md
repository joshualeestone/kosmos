# agenone-6405: a computer's join request shows no "23 hours ago"

Card: joshualeestone/kosmos#6405 (Josh's 0.7.55 pairing test: the laptop dated tmnt's fresh request "23 hours ago").

## Finished looks like
On the computer that allows, a joining computer's request card shows no age and is never faded as old (its row keeps
one first_seen across every attempt, so the age was the first ask, not this one). A phone or browser's card is
unchanged: it says when it asked and fades after an hour. A browser check proves both with a day-old pair of rows.

## Call
Drop the age for computer rows rather than date them from the current attempt: the pending row carries no time for the
current attempt (the code's time lives in the tunnel's pairing file, not in the row), and the card already says where a
computer is (its code, or the wait line). Rejected: a new field from the tunnel (a cross-repo change for a number the
card does not need). Weakest premise: that nobody needs to know how long a computer has been waiting; the wait line
covers what matters (why no code yet). It removes text, so it fits Josh's 10-17 clean-UI ruling.

## Review 1 (opus) changes
- A row that was a computer (was_a_computer) is a computer's row too: askComputerRow covers both.
- Turning away a computer's row always gets the fresh wording with "change that email's password": its first_seen
  says nothing about when it asked, so the "old request, no accusation" branch cannot apply.
- Follow-up #6417 for the compact notice's dismissal key, which uses first_seen too (same root cause, older code).

## Review 2 (sonnet) changes
- web.allow-card.test.js pinned the old stale expression by its text: it now pins the new one, askComputerRow and the
  conditional age span (it failed after round 1; I had not run it).
- A CONTROL: a day-old phone turned away keeps the old-request wording, no password sentence.
- The old-request wording no longer has a computer branch (it can no longer be reached).

## Steps
1. web/index.html: askComputerRow(d) (joining, or was_a_computer); the request card gives such a row no age span and no
   stale fade, and turning it away always gets the fresh wording with the password sentence.
2. web.allow-card.test.js: pins the new stale expression, askComputerRow and the conditional age span.
3. render-connect-sheet-4637.js: the one-line age check now expects one age (the phone's); a day-old computer row has
   no age and is not faded; CONTROL: a day-old phone row has its age and is faded.
