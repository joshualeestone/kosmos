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

## Review 1 (blind, opus): two blockers
As first written it showed nothing on a normal board, with every test green, because each test stubbed the seam that was wrong. (1) LC_ALL=C on tmux outside a pane turned the format's tabs to underscores: 0 of 20 panes. Now `tmux -u`, with ps alone under C. (2) The route read by `sessionName`; samples are keyed by the raw session. Also fixed: a bare-name shell missed the folder road (comm is argv0); a small wrapper with a large child was invisible (now by subtree); the not-running row and card had no line, which I had claimed they did; the card could say left running while the page did not; a failed tmux replaced a good sample; a stuck child could end sampling; "folder" evidence lost to a named process beside it; apps crowding the candidates; an argument posing as the variable; systemd --user orphans; the list view; the words "left by an earlier run", false for a nohup server.
The new tests run a REAL tmux on a private socket, outside a pane, under a C locale, through the real sample and read, with a control that the locale really does eat the tabs.

## Review 2 (blind, sonnet) and what I found reading it
Fixed: the board could be charged to an agent if started from its pane, and the page would then say to end it; the running list row's flag was an eighth grid child; a slow machine's sample could outlast read's limit (now a shared 30 s budget, largest first). Found while fixing these, and mine: sizing by subtree made tmux's server, parentless and above every pane, the largest "leftover", which could charge one agent for all of them. The board, what is above it, the tunnel and tmux are now never candidates, and a subtree stops at a pane.
Stated and left: two sessions mapping to one name in readAgent take the first; a wrapper at AGENT_WORKFORCE_TMUX_BIN that refuses -u leaves the feature blank.

## Review 3 (blind, opus, aimed at what the page may name)
Blocker fixed: an environment that reads and lacks the variable was also sent to the folder clue, so another Kosmos's board or a service in an agent's folder could be named. Now `ps -E` is compared with plain `ps`: nothing past the arguments means hidden, and only that takes the folder road, which also stops an argument posing as the variable. Anything launchd runs is never named, and with no list the folder clue is off. The sentence asks whether the process is still needed rather than saying to end it, since a nohup server may be deliberate; "or restart your computer" went with it. A floor on the sentence; a pane above the home folder is no clue; "server exited" is not an empty board; nested owners count once.
Stated and left: a later variable whose value contains the name could pose as it. Requires a person's own env value to hold that exact text.

## Design (Mona Lisa)
"left running" on the card; "this computer's memory" on the page, since the panel below is headed Memory; the leftover its own sentence, ending on what the person can do; processors in whole numbers.

## Tests
`engine/machinecost-7978.test.js`, including real parentless processes on this computer: a node named by its environment, a shell by its folder, and a control that macOS still hides the shell's environment. `web.machinecost-7978.test.js`: the words and each threshold's edge, read from the page. Shots through mobile-shots.js, each with a verify step.
