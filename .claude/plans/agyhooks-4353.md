# agyhooks-4353: write the report hook for already-running Antigravity agents (kosmos#4353)

An agy agent launched before #4043 keeps its old supervisor (which has no hook step), and the
board adopts running agents rather than restarting them, so its card said "Can't tell".

## Design
- `engine/agyrefresh.js`: for every RUNNING agent of this Kosmos (create.runningJobs) whose job
  runner is 'antigravity' AND whose launch folder has no Kosmos entry in `.agents/hooks.json`
  yet (a WORKING entry: each handler present names a node and bridge that exist; a malformed or
  stale one is repaired), call agyhooks.ensureHooks(folder, allowance.stableNode(),
  create.agyBridgePath(), keepTools), keepTools true only when the broken entry had the tool hooks.
  - The folder is argument 3 of the agent's own plist (what the running supervisor was started
    with), read through create.plistArgs (the same parse readJob uses), falling back to
    create.workerDir(name).
  - The node is stableNode(), not process.execPath: a versioned Homebrew path dies at upgrade.
  - Working/Idle hooks only (withToolHooks false): the running agy may be older than the binary
    on disk, and the ask_question tool hooks are only safe on a new enough agy, so they are left
    to a CURRENT supervisor, which rewrites the entry with them when it next starts (an old
    supervisor's relaunch loop never touches hooks.json). So there is
    no version probe at all. The supervisor can still write between check and write; if this
    write lands second it replaces a tool-hooked entry with a Working/Idle one until the next
    launch (needs_you for a question lost meanwhile; board start racing an agy launch).
  - Nothing is written when the bridge is missing (its handlers would fail every turn, and a later current supervisor would leave the entry alone). Not on
    win32. Never throws.
- A broken entry (PreInvocation or Stop missing, or naming a node or bridge that is gone) counts as absent and is repaired; a repair keeps the ask_question tool hooks when the old entry had them (only a current supervisor writes those, after its version check).
- Only agents with no working entry: rewriting an existing one would make the board and the supervisor
  take turns (different node spellings).
- server.js: once at board start, after installSupervisor, not under AGENT_WORKFORCE_DRY_RUN,
  deferred with setImmediate (its reads and writes happen after start, not in it); logs each agent it hooked and each failure (not the git-project refusal).
- readJob is NOT changed. engine/create.js gains one export, plistArgs(name, worldId), which
  readPlistJob now calls (same name guard, read, block match and unxml, same null cases), so the
  refresh reads the launch folder from the same parse the supervisor's job is read from.
- server.js logs a refresh that fails (best effort, but not silent).

## Evidence the write is enough without a restart
Measured on the card (comment 5872366045): hooks.json written mid-session fired on the next
two turns, with a control that fired when present at start.

## Rejected
- Restarting the agents: it loses their conversation.

## Weakest premise
- n = 2 turns on agy 1.2.12 on one Mac. A changed (not new) entry was not measured.
