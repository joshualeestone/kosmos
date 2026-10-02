# tmuxsocket-2955: Kosmos's tmux and a newer tmux on the same Mac

Card: joshualeestone/kosmos#2955. Angel measured it on Agent1s after the 2026-10-01 power-outage reboot: the board
(pid 792) started at 13:42:45 on Kosmos's bundled tmux 3.5a; at 13:42:48 the fleet's Homebrew tmux 3.6a started the
server on the default socket; two tmux versions cannot share a socket, so the board read no agent ("server exited
unexpectedly") until Angel pointed the bundled path at Homebrew's. Splinter put it ahead of #4409 slice 3 (19:47).
Mortals, checked the same evening: the same wall (bundled 3.5a against Homebrew 3.7c), hidden because its board was
started with AGENT_WORKFORCE_TMUX_BIN=/opt/homebrew/bin/tmux.

## Decided: NOT a private socket (the card's option 1)
Kosmos shares the person's tmux server ON PURPOSE: install/kosmos and install.tmux-pick.test.js record why (the adopt
audience: "you already have agents here" exists to show agents a person already runs in their own tmux). A private
socket would hide every one of them, and on the fleet every Discord bot. It would also need every existing agent's
launchd job rewritten (plists are written once) or its supervisor would restart the agent on the other socket and run
it twice. Rejected for those reasons; reopen if the adopt screen is ever dropped.

## Change
1. install/kosmos `_kosmos_pick_tmux`: a system tmux that answers in its own words that there is NO SERVER ("no server
   running", or "error connecting to ... (No such file or directory)") now wins over the bundled copy. It ran,
   connected and found none: it works, and the person's own tmux is the one that will start their server. Before, the
   bundle was kept, a bet lost on Agent1s. Any other refusal still keeps the bundle, and a candidate that can LIST a
   server still wins over a serverless one.
2. bin/agent-supervisor.sh `_kosmos_supervisor_tmux`: a supervisor whose baked tmux path is a Kosmos home's bundled
   copy uses the launcher's recorded pick (<home>/tmux/chosen) if it names a runnable file. Without this, change 1
   would split old agents (bundled, baked in their plists) from the board (now the system tmux): the same wall, the
   other way round. Any other baked path is left alone.
3. install/kosmos writes that record, only for its own pick (not an explicit AGENT_WORKFORCE_TMUX_BIN), only into an
   installed home, and only when it changed (every `kosmos` command runs the launcher).
4. engine/status.js `lookProblemFor`: the board's detail line for the version wall says what it is and that restarting
   Kosmos fixes it (change 1 makes that true), instead of the bare "server exited unexpectedly" (the card's option 2).

5. bin/agent-supervisor.sh twin_session_may_live: `printf | awk; $?` became `awk <<<"$_tl"; $?`, the same status (awk's
   exit is the answer: found or not), because the #632 pre-commit hook refuses any staged shell file with `$?` after a
   pipe and this line is on main. Equivalence measured both ways (found 0, missing 1).

## Weakest premise
That the supervisors and the board converge at boot. A supervisor reads the record when it starts; the board re-picks
at each launch. If the record is absent (a Mac that has not run the new launcher yet) supervisors use the bundle and
start a 3.5a server; the board's probe then cannot list it, no candidate wins, and it keeps the bundle too: consistent.
Not measured on a real reboot of a Mac with Kosmos-created agents and a newer Homebrew tmux. Second: a person who
upgrades Homebrew tmux while its server runs meets the same wall with their own tmux; nothing here changes that.

## Tests
install.tmux-pick.test.js (14): the serverless answer wins, both wordings; the version wall, a permission refusal and
tmux's protocol-mismatch line keep the bundle; a LISTING candidate beats a serverless one. supervisor.tmux-chosen-2955
.test.js (4): the follow, its controls (no, empty, missing, unrunnable record; another baked path), the record written,
not rewritten when unchanged, not written for an explicit choice. engine/status.test.js: the version wall's detail and
its controls. Every guard mutated: each reds its test, except the supervisor's "only the bundled path" case, which is
belt and braces (for any other path the derived record path cannot exist). 81 test files that read install/kosmos or
the supervisor pass.
