# agy-status-4043: Antigravity agents report Working / Idle through agy's own hooks

Card: kosmos#4043 (Josh 2026-09-26: agy agents always show "Can't tell"). Stacked on #4039's branch
(ring-providers-4039); rebase onto main once that merges.

## Measured (card comments)
agy 1.2.x, a real print-mode turn with capture hooks on Agent1s: PreInvocation -> PostInvocation ->
Stop, in that order; payload carries conversationId, workspacePaths, modelName; Stop adds fullyIdle,
terminationReason, error. The payload does not name its event. A fresh self-report already wins
over the scraped UNKNOWN in reconcileReport (checked by calling it: working -> working, idle -> idle).

## Change
- bin/agy-report-bridge.js: event from argv; prints `{}` FIRST for EVERY event (agy reads stdout as the
  answer; an empty decision is no decision since agy 1.0.16); PreInvocation -> working, Stop -> idle (an error named in the text),
  ask_question PreToolUse -> needs_you, ask_question PostToolUse -> working; POST budget 1.5s,
  stdin 1s, since PreInvocation runs before every model call; auto:true; exit 0 always.
- engine/agyhooks.js: merges one `kosmos-report` entry into <workdir>/.agents/hooks.json; keeps the
  person's other hooks; leaves a non-JSON file alone; atomic write only on change; sh-quoted paths.
- bin/agent-supervisor.sh: runs agyhooks before every agy launch (after agytrust), with the bundled
  NODE_BIN and the bridge beside the supervisor.
- create.js installs the bridge into supportDir/bin like its three siblings; both bundle scripts ship it.

## Rejected
- Hooking PreToolUse for any tool but ask_question, or answering it with a decision: it is agy's
  permission gate. For ask_question the answer is `{}`, no decision.
- Mapping an idle loop, or any event but a real ask_question, to needs_you (#4006).
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

## Iteration 2 (sonnet): converged
- No BLOCKER/WARNING; its notes (the shared `nopane` throttle bucket, mirroring kosmos-report-hook.sh;
  the symlink/mode write) are the decisions recorded above.

## Added after convergence (Splinter, 2026-09-26 20:59, from Gemini-Sub's spec on the card)
- agy's `ask_question` tool: PreToolUse (matcher `^ask_question$` only) -> needs_you with the question
  as the text; PostToolUse (same matcher) -> working. The bridge re-checks toolCall.name. PreToolUse
  answers `{}` (superseded below: first `allow`, then `{}` after review 3). Unmeasured live: PreToolUse firing for it (the args key was settled by review 3, below). Release check #3.
- Review iteration 3 (opus): the question is at args.questions[].question (agy's schema, from the
  binary) -> read there; `allow` was an unmeasured active decision -> `{}`; header/plan contradictions
  fixed; the stdout test isolated its pane.
- RISK, stated: a needs_you never decays; if the person cancels an ask_question and agy fires neither
  PostToolUse nor Stop (unmeasured), the card reads Needs you until the next prompt's PreInvocation.
  Release check #4: cancel an ask_question and see what fires.
- Review iteration 4 (sonnet): the stacked base moved (the rebase is planned: --onto origin/main past
  #4039's old tip); the throttle's bare 'nopane' could merge agents without a pane -> the Claude hook's
  chain (pane, token hash, parent pid, then nopane). Otherwise clean, with the schema and the empty-
  decision premise re-verified against the agy 1.2.x binary.
- Review iteration 6 (opus): (W1) no minimum agy version -> the supervisor passes `agy --version`
  (measured 0.06-0.4s) to agyhooks, and the ask_question tool groups are written only at agy 1.1.9 or
  later (1.0.16 fixed an empty pre-tool answer failing the tool; 1.1.9 fixed PostToolUse ignoring its
  matcher, per the changelog in the 1.2.11 binary). Older or unknown -> working/idle hooks only, reason
  on stderr. (W2) the pane throttle key now carries KOSMOS_PORT, so two worlds' %3 never share a marker.
  (NIT) marker-before-POST accepted and stated in the header. (NIT) Release check #5: does a subagent's
  or background loop's Stop fire this hook while the parent waits on ask_question (it would clear
  needs_you)?
