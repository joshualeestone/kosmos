# probeuser-9082: the default Claude account's probe reads the login its agents use (#9082)

## Problem (Renet's measurement, 11-25)
The create gate and Check now ran `claude -p` with CLAUDE_CONFIG_DIR=<home>/.claude for the DEFAULT account (#3136,
#3189). With the variable set, Claude Code reads a hashed Keychain entry (#2129), not the plain one the default's
agents use: usually none ("Not logged in"), or a stale one. That is how 0.8.23 refused a signed-in account once #9031
added those words to CLAUDE_DEAD_AUTH; they were taken out again for 0.8.24.

## Measured (this Mac, launchd job in the GUI session, Claude Code 2.1.332)
Unset -> ok. Set to ~/.claude -> "OAuth session expired and could not be refreshed" (a month-old hashed entry). Unset
with USER/LOGNAME removed -> "Not logged in". Unset with HOME removed -> ok. The running board's node process has USER,
HOME and LOGNAME and no CLAUDE_CONFIG_DIR. So the dependency is USER, not HOME (#3136 blamed HOME; most likely USER).

## Change
- engine/create.js: `claudeProbeDir(dir)` returns null for the default account (accounts.isDefaultDir), the folder
  otherwise; the create gate uses it. With no folder, `defaultClaudeProbe` unsets CLAUDE_CONFIG_DIR (every spelling)
  and fills USER, LOGNAME and HOME from the operating system when missing (`fillLoginIdentity`).
- server.js: Check now (`/api/accounts/claude/check`) uses `create.claudeProbeDir`; the badge join stays on acct.dir.
- CLAUDE_DEAD_AUTH gets #9031's three back (from 317618978a), with the reason beside them.

## Decisions
- Fill USER from the OS rather than trust the board's environment: a probe that loses USER says "Not logged in", and
  with #9031's words back that would refuse a working account (the false refusal this gate must never make).
- Rejected: keep the folder and drop #9031's words (the card's "unknown, create goes on" today): it leaves a stale
  hashed entry able to refuse with "Login expired" and leaves a dead default undetected.
Weakest premise: one Mac measured. A board started some other way (Linux systemd, Windows) is covered by the filled
USER/HOME, but not measured; Windows Claude keeps a credentials file, not the Keychain, so the variable's meaning there
is unchanged by this.

## Tests (restated pins and new arms; each fails with main's create.js/server.js)
- engine/create.account-connectable-1903: the default is probed with null; dead only when unset.
- engine/loginended-9031: the four ended/none answers are NONE again for a labelled folder; claudeProbeDir default/labelled.
- server.badge-observed-1921: Check now's "Not logged in" is a dead sign-in; the default probes unset and greens.
- server.create-live-1903: a real probe against a fake claude that answers "Not logged in" when the variable is set:
  the default passes unset; a second arm without USER/LOGNAME passes with the OS user filled (fails without the fill).

## Review round 1 (opus): 0 BLOCKERs, 2 SHOULDs, NITs, all fixed or answered
- SHOULD: bin/agent-supervisor.sh pins default agents to the tmux server's global CLAUDE_CONFIG_DIR when set (#3417);
  probing unset there would refuse a working account --> FIXED: claudeProbeDir asks tmux the same way
  (sessionccd.globalClaudeDir, `show-environment -g CLAUDE_CONFIG_DIR`) and probes that folder when set.
- SHOULD: USER filled only for the default, though the restored words now refuse labelled accounts too --> FIXED (both arms).
- NIT: the restored words are states; count them only from a failed run --> FIXED (CLAUDE_DEAD_STATE, exit != 0).
- NIT: a sandboxed board (AGENT_WORKFORCE_HOME) would probe the real login --> FIXED: the default is probed unset only
  when its folder is the real os.homedir()/.claude; two test sandboxes now set HOME too.
- NITs: stale comments in create.js and the create-live test header --> FIXED.
Tests: loginended-9031 gains the pinned/removed/unknown/no-tmux/labelled/sandbox arms and the failed-run-only arm; each
fails with its rule removed. 179 probe-related tests pass.
