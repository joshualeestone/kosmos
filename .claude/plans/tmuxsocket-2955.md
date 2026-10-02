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
1. engine/status.js `tmuxRepick`: when the board's look meets the version wall ("server exited unexpectedly" with a
   socket on disk, or "protocol version mismatch"), it asks the known tmux binaries (/opt/homebrew/bin/tmux,
   /usr/local/bin/tmux) and switches the whole process to the first that can LIST the server: AGENT_WORKFORCE_TMUX_BIN
   (every engine module reads it at call time) and PATH (for bare `tmux` calls). Then the look is retried, in the same
   call: no restart. Only over the launcher's own pick (KOSMOS_TMUX_BIN_PICKED=1): an explicit choice (a harness stub,
   a sandbox's inert tmux, a person's) is never replaced.
2. bin/agent-supervisor.sh `_kosmos_supervisor_tmux`: the same rule, at each start of an agent's job, before its first
   look: if the baked tmux meets the wall, the first tmux on PATH or in the known places that can LIST the server wins,
   and goes first on PATH so a bare tmux in the pane agrees. Plists are never rewritten, so this is where an old
   agent's choice can be made.
3. engine/status.js `lookProblemFor`: when no reader is found, the detail line says a different version may be running
   the sessions and Kosmos found no tmux that can read them (the card's option 2), instead of the bare tmux text.
4. bin/agent-supervisor.sh twin_session_may_live: `printf | awk; $?` became `awk <<<"$_tl"; $?`, the same status (awk's
   exit is the answer: found or not), because the #632 pre-commit hook refuses any staged shell file with `$?` after a
   pipe and this line is on main. Equivalence measured both ways (found 0, missing 1).

## Rejected in review round 1 (my first design)
Preferring a system tmux at launch whenever it answered "no server", and recording the pick in a file for supervisors.
It made the pick a race between whoever ran `kosmos` last and the running board, the record was deleted by every
update (setup.sh replaces the tmux directory), an empty record aborted the launcher under set -e, and it tied Kosmos's
own agents to Homebrew's tmux, which a `brew upgrade` can pull out from under them. Now: with no server, nothing
changes (Kosmos keeps its own tmux); only a live server that our tmux cannot read moves anyone, and everyone moves the
same way, by asking that server.

## Weakest premise
That the board and the supervisors converge: both ask the live server the same question, so they land on the same tmux,
but only the board re-asks while it runs; a supervisor asks once per start. A supervisor that started a bundled server
before any newer one existed keeps it, and then the newer tmux (a person's, the fleet's) is the one that cannot read
(Kosmos sees its agents; the person's own tmux client does not). Not measured on a real reboot of a Mac with
Kosmos-created agents and a newer Homebrew tmux.

## Tests
engine/status.test.js: the switch (env and PATH), an explicit choice never replaced, nothing that cannot list taken,
the look succeeding in the same call, the wall's detail and its controls. supervisor.tmux-reader-2955.test.js: the
switch at the wall (both wordings) with PATH; a working tmux, no server, a permission refusal and an unlisting
candidate all keep the baked path; the reader is called before the first look. Every guard mutated, each reds its
test. 115 test files that read the supervisor or the status engine pass.
