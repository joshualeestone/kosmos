# #2808 class-1 (a) / #2129: re-apply folder-trust + bypass pre-accept on every (re)launch

Josh, 2026-09-14 (locked #2808 ruling): the end user must never see Claude Code's technical
permission/trust prompts. Class 1 = auto-approve them invisibly. Splinter greenlit option (a) - the
supervision-layer re-apply - as the reversible, ship-now slice (no risky send-keys), and it is likely
the actual #2129/#3055 restart-hits-trust ROOT.

## The gap (measured on origin/main)

Two of three class-1 pieces already exist: PREVENTION (engine/create.js calls trustFolder +
preacceptBypass; the launch carries --dangerously-skip-permissions) and DETECTION (status.js
classifies the prompts). But create.js writes trust/bypass ONCE, at CREATE. A restart re-runs
bin/agent-supervisor.sh, NOT create.js, and the supervisor did NOT re-apply them. Agents restart
constantly (launchd KeepAlive, `kosmos restart`), and --dangerously-skip-permissions does NOT answer
the folder-trust dialog (a separate startup gate, #2129). So a restart into a state where the
create-time key is absent/unread (a fresh macOS user; a config the write missed) parks the agent on
the #2129 trust prompt in a TUI nobody can answer - the catastrophic wedge, on a restart.

## The fix

- **engine/ensure-launch-trust.js** (NEW): a best-effort, idempotent shim that re-applies exactly
  create.js's calls - trustFolder(workdir, {configDir, createIfAbsent:true, agentDefaultAccount:!configDir})
  + preacceptBypass(configDir, !configDir). Always exits 0 (a re-trust failure must never block a
  launch, same posture as bin/codex-dismiss-update.js). Claude-only.
- **bin/agent-supervisor.sh**: on the CLAUDE launch arm, before `new-session`, invoke the shim via
  the already-resolved $_eng + $NODE_BIN (same resolution + best-effort guard as the codex-dismiss
  shim right above it): `"$NODE_BIN" "$_eng/ensure-launch-trust.js" "$WORKDIR" "${CLAUDE_CONFIG_DIR:-}"`.
  Claude arm only - the codex arm has its own trustCodexFolder + dismiss shim, and its
  CLAUDE_CONFIG_DIR is a CODEX_HOME that must never take a CLAUDE trust write.

## Tests

- **engine/ensure-launch-trust.test.js** (5): both keys land for a default-account agent; idempotent
  (byte-identical files on the second call); empty-workdir no-op; non-absolute workdir soft-fails
  without throwing; a CONTROL proving a fresh sandbox is untrusted (the assertion is not vacuous).
  All three roots sandboxed (AGENT_WORKFORCE_CLAUDE_CONFIG/SETTINGS/DATA) so it never touches the
  operator's real config.
- **tools/test-supervisor-retrust-2808.sh** (in test:shell): drives a COPY of the real supervisor
  with engine-path -> the real engine, a stub tmux, and the three roots sandboxed, and asserts the
  Claude arm wrote BOTH keys BEFORE the launch (end-to-end supervisor -> shim -> trust.js). It
  `env -u CLAUDE_CONFIG_DIR CODEX_HOME`s the run - without that the inherited real CLAUDE_CONFIG_DIR
  makes the shim write the operator's real account config (measured + cleaned during development;
  the a-test-of-the-real-env-branch hazard).

## Scope / follow-ups (documented on #2808/#2129, NOT this branch)

(a) ships here. (b) a new 2.1.x gate and (c) the live invisible auto-handle (auto-send the affirmative
+ clear when a technical prompt still surfaces, reusing status.js's by:'auto' classification + the
/api/agent/<name>/trust-and-restart route + the #2456 clear seam that protects by:'agent') need the
QA/screenshot context + a live repro and couple to Angel's class-2 by/permissionAsk plumbing; synced
with Angel, tracked as follow-ups. Full challenge-loop before PR. `Addresses #2808` + `Addresses #2129`
(non-closing).
