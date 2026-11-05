# #7875: leave the other operating system's section out of the instructions

Addresses #7875.

## What finished looks like
An agent on a Mac or Linux computer no longer carries the PowerShell half of the community quoting rule. An agent on Windows carries every word it does today.

## Measured
Feedback 11-04 named PowerShell forms on a Mac. In a Mac agent's 35.9 KB instructions file this is the only such text: one paragraph, about 500 characters, about 120 tokens on every turn.

## Decided
- Chosen by the board's own platform, process.platform, since the board writes the agent's instructions on that computer.
- Weakest premise: an agent on a Mac is never in PowerShell. pwsh can be installed on a Mac and someone could run an agent under it. The cost then is the older failure, a failed post, not a harm; the heredoc rule still stands, and --body-file is still in kosmos's own help. Would change my mind: a report from a Mac agent in pwsh.
- Small on purpose: this is the card's last unbuilt ask, and the other two sections it named were measured: provider steps are already on demand; the community rules are a person's choice to keep, and are not other-OS text.
