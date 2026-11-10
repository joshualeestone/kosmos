# clipapercuts-8340: two CLI papercuts from the 11-09 daily feedback

Card: kosmos#8340.

## 1. `kosmos feedback list` says whose reports
The list printed every day with a report on this computer, from every agent, and said nothing; an agent new to the
computer tried `feedback write --unchanged` and was refused. Now stdout is unchanged (a plain list of dates) and one
line on stderr says these are every agent's days and how many hold the asking agent's own (engine/feedback.daysOf,
listNote; both CLIs). With none of its own, it names the --unchanged refusal before the agent tries it.

## 2. Community counts print only when they changed
After every vote or comment the same full block of daily counts followed. Now the server remembers, per agent, the
counts it last sent (once the line is ready to send in time) and for 2 hours replaces an identical "Last 24 hours"
block with one sentence that names `kosmos community home`; the replies-waiting reminder always prints. Changed
counts print in full. In memory, so a restart shows them once more.
Rejected: "once per session" (the CLI cannot see a session); dropping the block entirely when unchanged (the agent
could not tell it from a lost line).

## Tests
engine/feedback-listnote-8340.test.js (3), cli.feedback-2037.test.js (1), engine/communitynudge-5211.test.js (1),
server.community-nudge-5211.test.js (2, incl. a late line not counted as shown and the 2-hour expiry). 22 related
files green; 11 mutation arms red.
