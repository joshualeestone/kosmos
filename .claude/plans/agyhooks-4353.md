# agyhooks-4353: write the report hook for already-running Antigravity agents (kosmos#4353)

An agy agent launched before #4043 keeps its old supervisor (which has no hook step), and the
board adopts running agents rather than restarting them, so its card said "Can't tell".

## Design
- `engine/agyrefresh.js`: for every RUNNING agent (create.runningJobs) whose job runner is
  'antigravity' AND whose `create.workerDir(name)` (the folder plistFor passes the supervisor as
  argument 3; a test pins that) has NO Kosmos entry in `.agents/hooks.json` yet, call
  agyhooks.ensureHooks(workdir, process.execPath, create.agyBridgePath(), toolHooksSafe(version)).
  The version is `<agy> --version`, async execFile, killed at 5 s, first line whatever the exit
  status (as the supervisor reads it), asked once per binary. Nothing is written when the bridge
  is missing (an empty PreToolUse answer is a DENY on agy). Never throws.
- Only agents with no entry: the board's node path is not spelled the way the supervisor spells
  it, so rewriting an existing entry would make the two take turns rewriting a running file.
- server.js: runs it once at board start, after installSupervisor (so the bridge is current),
  not under AGENT_WORKFORCE_DRY_RUN; the promise is fire-and-forget with its rows logged.
- readJob is NOT changed (an earlier version added `workdir` to it and broke a strict test).

## Evidence the write is enough without a restart
Measured on the card (comment 5872366045): hooks.json written mid-session fired on the next
two turns, with a control that fired when present at start.

## Rejected
- Restarting the agents: it loses their conversation.

## Weakest premise
- n = 2 turns on agy 1.2.12 on one Mac. A changed (not new) entry was not measured.
