# uabortlinux-5860: the stuck-update notice names a step a Linux server can take

Card: #5860 (Sonya Blade, in review of #4675). Owner: April (night shift shard).

## Traced
`paintUpdateAbort` (web/index.html) has a Windows arm (`windowsCopy('updateAbortRemedy')`, sign out and back in) and, since
#4675 (PR #5863, Sonya Blade), per-reason sentences built from `AGENTS_FINE`, `REOPEN`, `TRY_RESTART` and `TRY_BOTH` for
everyone else. A Linux board reaches those, which say "Quit and reopen Kosmos", "quitting and reopening Kosmos is worth a
try" and "they do not live in this window"; a Linux server has no Kosmos window.

## What
A Linux switch inside the function (`const linux = onLinux()`, after Windows wins as before): on Linux, `REOPEN` says to
run `kosmos restart` in a terminal on the computer running Kosmos (over SSH on a headless server), `TRY_BOTH` offers that
command first and then restarting the computer, and `AGENTS_FINE` drops "this window". `TRY_RESTART` (a failed check:
restart the computer) is true on Linux as it is and is unchanged. Why the command is true there, each checked on main:
- `kosmos restart` (install/kosmos `cmd_restart`) stops and starts the board; a board under its unit goes through
  `systemctl --user` (#4918).
- Restarting the board does not take the agents down: the board unit has `KillMode=process` (engine/linuxboard.js,
  pinned by engine/linuxjob.test.js #4918), and with no unit the agents' tmux server is separate from the board anyway.
- install/setup.sh puts `kosmos` in ~/.local/bin and adds a PATH line to ~/.bashrc (or ~/.profile), so the command is
  there in an interactive bash login, the usual SSH session. Not for every shell (review 2): a zsh or fish login, or a
  non-interactive `ssh host kosmos restart`, may need ~/.local/bin/kosmos spelled out. The copy keeps the plain name the
  rest of the product uses for its CLI; spelling the path is a wording choice left to Mona Lisa.
- `agent_board_guard` refuses only agents; a person typing it goes straight through (review 4, traced).
The Mac tests forbid a typed instruction, and #6 (Josh) scrapped the "run kosmos restart" instruction for a gentle GUI
action. Both assume a screen. A headless server has none, so a typed command is the one step there is, which is what the
card asks for; only Linux gets it, and the code comment cites #6. The words stay Mona Lisa's to refine.

## History
First built on the pre-#4675 two-arm painter (branch history to f8fea7227, kept locally as uabortlinux-5860-pre4675),
reviewed over five iterations, then rebuilt on main after #4675 merged (PR #5863) with the conflicting structure, as
this card's note on #4675 said the second to land would.

## Not here
- Other Mac-only words a Linux board can reach (the world-switch "Quit and reopen" sentence, the offline note's
  "Applications folder", the #4343 restart screen's restartHow "Open Kosmos again from your Applications folder"): noted on
  follow-up #5862 (filed in review 3), not changed here.

## Weakest premise
That a stuck update on Linux is cleared by a board restart the way a Mac's is by reopening. Neither has been seen on a real
Linux board (the card says so too); the step is at least one the person can take and is not destructive. One known case
it cannot fix: if the abort came from a stop that genuinely fails (cmd_stop's "Could not stop it" path, which exits
inside the function), kosmos restart uses the same cmd_stop and fails the same way, with an honest error. Whoever first
sees a real Linux abort should check that branch first. A second (review 3): a board under its systemd unit is stopped
and started through `systemctl --user`, which needs the person's user session (XDG_RUNTIME_DIR); from `su` or `sudo -u`
it can fail ("systemd did not stop ..."), so check how the person reached the shell too.

## Tests
web.win32-board-copy.test.js: every stop reason on a page stamped linux (busy, a held port, an unknown stop, a failed
check): the exact sentences, no Mac or Windows step (case-insensitive), and darwin and win32 controls that never name the
command. Checked red with the Linux switch forced off. The existing MAC UNCHANGED, Windows and #4675 assertions stay.
