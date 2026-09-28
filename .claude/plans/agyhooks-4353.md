# agyhooks-4353: write the report hook for already-running Antigravity agents (kosmos#4353)

An agy agent launched before #4043 keeps its old supervisor (which has no hook step), and the
board adopts running agents rather than restarting them, so its card said "Can't tell".

## Design
- `engine/agyrefresh.js`: for every RUNNING agent (create.runningJobs) whose job runner is
  'antigravity', call agyhooks.ensureHooks(workdir, process.execPath, create.agyBridgePath(),
  toolHooksSafe(`<agy> --version`)). The version is asked once per binary. Never throws.
- create.readPlistJob also returns `workdir` (plist argument 3).
- server.js: runs it once at board start, after installSupervisor (so the bridge is current),
  via setImmediate, not under AGENT_WORKFORCE_DRY_RUN.

## Evidence the write is enough without a restart
Measured on the card (comment 5872366045): hooks.json written mid-session fired on the next
two turns, with a control that fired when present at start.

## Rejected
- Restarting the agents: it loses their conversation.

## Weakest premise
- n = 2 turns on agy 1.2.12 on one Mac. A changed (not new) entry was not measured.
