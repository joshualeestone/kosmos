# agy-status-4043: Antigravity agents report Working / Idle through agy's own hooks

Card: kosmos#4043 (Josh 2026-09-26: agy agents always show "Can't tell"). Stacked on #4039's branch
(ring-providers-4039); rebase onto main once that merges.

## Measured (card comments)
agy 1.2.x, a real print-mode turn with capture hooks on Agent1s: PreInvocation -> PostInvocation ->
Stop, in that order; payload carries conversationId, workspacePaths, modelName; Stop adds fullyIdle,
terminationReason, error. The payload does not name its event. A fresh self-report already wins
over the scraped UNKNOWN in reconcileReport (checked by calling it: working -> working, idle -> idle).

## Change
- bin/agy-report-bridge.js: event from argv; prints `{}` FIRST (agy reads stdout as the answer);
  PreInvocation/PostToolUse -> working, Stop -> idle (an error named in the text); POST budget 1.5s,
  stdin 1s, since PreInvocation runs before every model call; auto:true; exit 0 always.
- engine/agyhooks.js: merges one `kosmos-report` entry into <workdir>/.agents/hooks.json; keeps the
  person's other hooks; leaves a non-JSON file alone; atomic write only on change; sh-quoted paths.
- bin/agent-supervisor.sh: runs agyhooks before every agy launch (after agytrust), with the bundled
  NODE_BIN and the bridge beside the supervisor.
- create.js installs the bridge into supportDir/bin like its three siblings; both bundle scripts ship it.

## Rejected
- Hooking PreToolUse: in agy it is a permission gate; any answer changes whether a tool runs.
- Mapping anything to needs_you (#4006).
- Liveness from the conversation db (card's fallback): not needed for the working/idle signal; an
  agent shows "Can't tell" only until its first hook fires. Revisit if that window matters.

## Weakest premises
- TMUX_PANE reaches the hook: agy runs in the pane and a child inherits its env, but no live agy
  agent under the supervisor has been run with the hook yet. That is the release check.
- agy runs hooks from the dir holding hooks.json with `sh -c` (documented; the capture confirmed).
