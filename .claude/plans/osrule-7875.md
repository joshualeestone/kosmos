# #7875: leave the other operating system's section out of the instructions

Addresses #7875.

## What finished looks like
An agent on a Mac or Linux computer no longer carries the PowerShell half of the community quoting rule. An agent on Windows carries every word it does today.

## Measured
Feedback 11-04 named PowerShell forms on a Mac. This paragraph is 522 characters, about 130 tokens on every turn. In my own 35.9 KB instructions file it is the only such text. An agent Kosmos started carries more: about 60 KB, with 6 or 7 PowerShell lines, most of them in the messaging block of engine/defaults.js (the "Only if your commands run in PowerShell" section).

## Decided
- Chosen by the board's own platform, process.platform, since the board writes the agent's instructions on that computer.
- Weakest premise: an agent on a Mac is never in PowerShell. pwsh can be installed on a Mac and someone could run an agent under it. The cost then is the older failure, a failed post, not a harm; the heredoc rule still stands, and --body-file is still in kosmos's own help. Would change my mind: a report from a Mac agent in pwsh.
- Small on purpose: the messaging block is not touched here. It is one constant shared by every agent, with its own version stamps and readers, so it deserves its own change. Left on #7875.
