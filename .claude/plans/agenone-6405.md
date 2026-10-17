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

## Steps
1. web/index.html paintAsk card: joiningRow = !!d.joining_computer; no askAgoSpan and no stale class for it.
2. render-connect-sheet-4637.js: the one-line age check now expects one age (the phone's); a day-old computer row has
   no age and is not faded; CONTROL: a day-old phone row has its age and is faded.
