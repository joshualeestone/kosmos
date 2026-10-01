# linux-spike-4904: does today's board run on Linux, and what breaks

Card: kosmos#4904 (pre-work 1 of #4903, Kosmos Cloud v1). A measurement, not product code. Branch `linuxspike-4904` is
throwaway: it carries only `spike/` and `.github/workflows/linux-spike-4904.yml`, and is never merged.

## Answer in one paragraph
The board starts on Linux unchanged (banner in 250 to 500 ms, serves its page) and nothing in it phones home. One
always-on agent is blocked by three things, in the order a create meets them: tmux is looked for at the Mac Homebrew
path, the platform list leaves Linux out, and the agent's keep-alive is a launchd job. With tmux pointed at its Linux
path and Linux let through, create gets as far as "started it" and fails there, cleanly taking itself back off the
computer. The keep-alive's replacement is proven: Kosmos's own agent supervisor, unchanged, runs under a systemd user
unit, and a killed agent is back in 11 seconds. The real Claude Code CLI reports itself to tmux as `claude`, which
the board and supervisor already accept. The port for one always-on agent is about 2 to 3 agent-weeks.

## What was run (ubuntu-latest, GitHub-hosted, free; node 26.10.0, tmux 3.4)
Every run blocked all outbound traffic at the firewall after installs, and logged each attempt. Control: a curl to
installkosmos.com failed as intended. The only blocked attempts were the runner's own Azure services (168.63.129.16
DNS/wireserver, 169.254.169.254 metadata); nothing from Kosmos. The board also had every outbound override closed and
`internal.json` written, as on any sandboxed board.

| phase | what | result |
|---|---|---|
| A | the board as it is, a stub agent CLI, a Claude account record | Boots in 0.5 s, serves `/`. Create refused: "we could not find tmux on this computer" (it looks at `/opt/homebrew/bin/tmux`, `engine/create.js:3128-3130`). |
| B | A, plus `linux` in `SUPPORTED` (`engine/platform.js:52`, a local edit on the runner only) | Same refusal: the tmux check comes before the platform gate. |
| B2 | B, plus `AGENT_WORKFORCE_TMUX_BIN=$(command -v tmux)` | Create answered "partial": made its folder, wrote its instructions, put the supervisor in place, set it up to keep running (a plist, on Linux), then "started it" FAILED (`launchctl`, `engine/create.js:5525-5527`); it rolled itself back. |
| C | `bin/agent-supervisor.sh` with the plist's five arguments, under a systemd user unit (`Restart=always`, linger on) | Unit active, the agent's tmux session up. Killed the session: systemd restarted the supervisor and the session was back in 11 s (NRestarts 1). |
| D | the real Claude Code CLI (2.1.287, no login) in tmux | `pane_current_command` = `claude` (accepted by `status.js` and `agent-supervisor.sh:193-195`). First start shows Claude Code's folder-trust question. |
| E | the node test suite on Linux | PENDING (see below). |

Not measured: a reboot (Hetzner, see below); a real signed-in agent answering (no credential on CI, by the card's rule).

## Hetzner
Splinter relayed Josh's go for one CX23 named kosmos-linux-spike-4904. Hetzner refused it: "Primary IP limit
exceeded". The project is at its IPv4 limit and holds SIX servers (adawhales, clawcabal, galley-forecast,
kosmos-relay, kosmos-coordinator, kosmos-community-1), none touched (listed before and after, identical). An
IPv6-only server would be allowed, but this Mac has no public IPv6, so it could not be reached. The one SSH key
registered for it was deleted. A reboot test needs a freed IPv4 or a raised limit (Josh's call).

## Inventory (every hit read, not counted)
Full table: the B/C/D sections below were read file by file. Method note: this Mac's `grep` is ugrep with `-I`, which
silently skips files it judges binary (`engine/a11ystatus.js`, `engine/worldimport.js`); counts were redone with
`command grep -a`. Earlier counts made with the plain `grep` may have the same hole.

The research's "63 engine files use launchctl/tmux/osascript" is right as a count of files that MENTION one of the
words (63 non-test, 172 with tests). Files that RUN one: about 14. Only 5 run launchctl (create, remove,
delete-leftover, machine, boardrestart) and 1 runs osascript (terminal).

**A. Stops the board starting:** none (measured: it starts).

**B. Breaks one always-on agent:**
- B5 first in practice: tmux defaults to `/opt/homebrew/bin/tmux` (`create.js:3128-3130`, checked at `create.js:4749-4766`; also `remove.js:556, 1202`, `connect.js:172-173`). Status, chat and messages use `tmux` from PATH and work. Fix: default to `command -v tmux`.
- B1: `engine/platform.js:52` `SUPPORTED` has no `linux`, so live execution is never armed. Under it `remove.js:177-180` returns `{ok:true, dryRun:true}`: remove and restart can report success while nothing happened (reasoned from source, not run).
- B2: the create path's keep-alive is a plist in `~/Library/LaunchAgents` (`create.js:257`, `plistFor` 2903-3066, write 5288-5292) started with `launchctl enable/bootstrap` (`create.js:5525-5527`). Linux: a systemd user unit with the same arguments (measured, phase C).
- B3: the same on adopt/repair (`create.js:3619-3622`) and the failed-create rollback (`create.js:4529-4546, 4882`).
- B4: stop, remove, restore and restart (`remove.js:463-510`; `jobFor` 576-617). Restart is what the Restart button, connlost-heal and autohandoff use.
- B6: tmux itself works on Linux (measured).

**C. Degrades, does not block one agent** (each fails with a sentence, or reads "could not check"): installing the
agent CLIs for the person (download lists are Mac/Windows); Keychain login-expiry dates (Linux keeps the token in
`~/.claude/.credentials.json`); `ps -Eww` in `runningas.js:153` (reasoned to fail on procps, so a non-default account
would read as the default); pmset sleep check; Accessibility and Full Disk Access gates; open-terminal (osascript),
reveal-in-Finder and System Settings buttons (`open`, `defaults`); attachment thumbnails (`qlmanage`); board
self-restart (launchctl); self-update (no Linux build); the agents' browser; the data folder lands in
`~/Library/Application Support/Kosmos` (`engine/store.js` non-Windows arm; should be `$XDG_DATA_HOME`); and the board
itself has no keep-alive on Linux (`kosmos start` falls back to `nohup`, `install/kosmos:1104`). The installer
(`install/setup.sh`) refuses Linux and downloads `darwin-` artifacts.

## Size estimate (agent-weeks, one person's always-on agent on a Linux box)
Must-have, about 2 to 3 agent-weeks:
1. A systemd-user job substrate beside launchd: `unitFor()` from the same fields as `plistFor`, and enable/start/stop/is-active in create, adopt/repair, rollback, remove and restart (B2 to B4). Keep the plist as the record or add a unit reader for set-model/set-account. 4 to 6 days.
2. tmux found on PATH (B5), then `linux` in `SUPPORTED` (B1). Half a day.
3. The board's own systemd unit, plus `loginctl enable-linger` so the board and agents start at boot with nobody logged in. 1 to 2 days.
4. A Linux installer: tmux from the package manager, Node, the Kosmos tarball (a linux build target), data under XDG. 3 to 5 days.
5. Headless Claude sign-in (`CLAUDE_CODE_OAUTH_TOKEN`, #2600) and Claude Code's folder-trust question answered for the agent's folder. 2 to 3 days.
6. A Linux CI job running the suite, and fixing what assumes a Mac. Size depends on phase E (pending).
Nice-to-have, about 1 to 2 agent-weeks: `/proc/<pid>/environ` for runningas; login expiry from the credentials file;
`xdg-open` for reveal; a web terminal for open-terminal; Codex/Gemini/Grok binaries for Linux; self-update for Linux;
the Mac-only gates hidden rather than "could not check" on Linux.

This sits at the low end of the research's 2 to 3 agent-weeks for the port, because the board boots unmodified and the
supervisor and tmux need no change (measured); the message and reply paths (tmux send-keys, the agent's HTTP
reply) read as portable but were not exercised end to end, since no agent got created through the board.

## Weakest premises
- Phase E is pending; the CI-fix line could grow the estimate.
- No reboot was measured (Hetzner IPv4 limit). systemd + linger surviving a reboot is standard, not shown here.
- No agent was created THROUGH THE BOARD on Linux (it stops at launchctl), so the board sending a message to an agent
  and reading its reply were not measured; they are reasoned portable from source. The next step that would measure
  them is the systemd substrate itself.
- No signed-in model answered (no credential on CI, by the card's rule).
