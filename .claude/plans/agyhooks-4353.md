# agyhooks-4353: write the report hook for already-running Antigravity agents (kosmos#4353)

An agy agent launched before #4043 keeps its old supervisor (which has no hook step), and the
board adopts running agents rather than restarting them, so its card said "Can't tell".

## Design
- `engine/agyrefresh.js`: for every RUNNING agent of this Kosmos (create.runningJobs) whose job
  runner is 'antigravity' AND whose launch folder has no Kosmos entry in `.agents/hooks.json`
  yet (an object entry, the same test ensureHooks applies), call
  agyhooks.ensureHooks(folder, allowance.stableNode(), create.agyBridgePath(), toolHooksSafe(v)).
  - The folder is argument 3 of the agent's own plist (what the running supervisor was started
    with), decoded with create.unxml, falling back to create.workerDir(name).
  - The node is stableNode(), not process.execPath: a versioned Homebrew path dies at upgrade.
  - The version `v` is `<agy> --version`, async execFile killed at VERSION_TIMEOUT_MS, first line
    whatever the exit status, once per binary; the has-hook check is repeated after that await
    (narrows, does not close, the race with the supervisor; both writes are working entries).
  - Nothing is written when the bridge is missing (an empty PreToolUse answer is a DENY). Not on
    win32. Never throws.
- Only agents with no entry: rewriting an existing one would make the board and the supervisor
  take turns (different node spellings).
- server.js: once at board start, after installSupervisor, not under AGENT_WORKFORCE_DRY_RUN;
  fire-and-forget; logs each agent it hooked and each failure (not the git-project refusal).
- readJob is NOT changed.

## Evidence the write is enough without a restart
Measured on the card (comment 5872366045): hooks.json written mid-session fired on the next
two turns, with a control that fired when present at start.

## Rejected
- Restarting the agents: it loses their conversation.

## Weakest premise
- n = 2 turns on agy 1.2.12 on one Mac. A changed (not new) entry was not measured.
