# #7978 item 1: what each agent holds in memory and CPU, on the board

Addresses #7978 (item 1; items 2 to 4 stay on the card).

## What finished looks like
A leftover like the one that prompted this, about 6.5 GB and a full core for 14 days, is visible on the board without anyone going looking. Show only: nothing is stopped or changed.

## Measured, 11-04
- By process tree, not terminal: an agent's tool children are mostly not on its terminal (1468 MB by tree, 405 MB by terminal).
- `ps` over 861 processes takes about 90 ms, so it runs through async execFile on its own 60 s timer, and a status read never starts one (#7693).
- macOS hides the environment of its own binaries. `ps -E` returned KOSMOS_AGENT_SESSION for node and a Homebrew python and nothing for /bin/bash, /bin/zsh, /bin/sh and /bin/sleep.

## Change
- `engine/machinecost.js`: each agent's pane tree, plus a left-behind process (its parent died). Those are named by KOSMOS_AGENT_SESSION from their environment; for Apple binaries, by their working folder being inside exactly one agent's pane folder, marked as weaker. Only large parentless processes are asked (at most 12), and only that one variable is kept.
- `/api/status` carries `machine` for agents of ours, from the last sample.
- The agent's page always says the numbers. The card says something only when out of the ordinary: something left behind, over 4 GB, or about a whole processor.

## Decided
- Rejected a number on every card: a figure there should mean look at this. The 4 GB and 90% limits come from one busy board (200 MB to 2.2 GB), so they are a first guess in one place. What would change them: a card flagged while nothing is wrong, or a leak under them.
- Rejected any stop or kill button: the ask is show only. The process number is shown so a person or an agent can act.
- Weakest premise: the folder clue. A shell that changed folder, or whose agent's pane is elsewhere, is not found. Tied folders and the home folder name nobody, so it stays silent rather than blaming the wrong agent. The CPU figure is ps's own, a decaying average on a Mac, so a brief burst can flag for a minute.
- Not on Windows: no tmux or ps, so the page shows nothing. A removed agent's leftovers show nowhere, since there is no card.

## Tests
`engine/machinecost-7978.test.js`, including real parentless processes on this computer: a node named by its environment, a shell by its folder, and a control that macOS still hides the shell's environment. `web.machinecost-7978.test.js`: the words and each threshold's edge, read from the page. Shots through mobile-shots.js, each with a verify step.
