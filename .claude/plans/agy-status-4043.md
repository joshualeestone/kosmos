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
- Liveness from the conversation db (card's fallback): not built. An agent shows "Can't tell" until
  its first hook fires, and a `working` report goes stale after REPORT_WORKING_DECAY (~5 min, measured
  with reconcileReport: 6 min old -> unknown, "it said it was working and has not said anything
  since") during a single tool run longer than that, or a turn interrupted without a Stop. Falling
  back to "Can't tell" is honest; revisit if Josh sees it.

## Weakest premises
- TMUX_PANE reaches the hook: agy runs in the pane and a child inherits its env, but no live agy
  agent under the supervisor has been run with the hook yet. That is the release check.
- agy runs hooks from the dir holding hooks.json with `sh -c` (documented; the capture confirmed).
- Stop per turn in INTERACTIVE mode (the supervisor launches agy interactive): measured in print mode
  only. Release check #2.
- The hooks.json write does not follow a symlink or keep the file's mode (agytrust does both): the
  file is in Kosmos's own worker folder, never a person's project, so this was left as it is.

## Challenge-loop iteration 1 (opus)
- BLOCKERS: the bridge was missing from install-board.sh, test-install.sh and the 2870 fixture --> added.
- WARNINGs: no throttle and PostToolUse per step inside agy's blocking loop --> 60s per-pane throttle,
  PostToolUse dropped; an open stdin could hold the bridge --> released + explicit exit; supervisor
  order untested --> source pin; timeouts untested --> a silent-board test; "Can't tell only until
  the first hook" overstated --> reworded above.
- CONVENTION: symlink/mode on the hooks write --> left, with the reason above. NITs fixed.
