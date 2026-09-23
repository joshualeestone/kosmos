# Grok launcher (#3391) -- a default-account Grok agent that spawns and self-reports

## Goal
Make a default-account, model-pinned Grok (xAI) agent creatable in Kosmos: it spawns
through the normal create path, receives tasks by send-keys (the shared chat.js
transport), and self-reports its full lifecycle to the board WITHOUT any pane scraping.
This is the exact mirror of the merged Gemini launcher (#3484 / #3296 slice 3), reusing
that machinery, with grok-specific deltas measured live against grok 1.0.41.

Additive only: an anthropic/openai/google create is byte-identical. No web/, MODELS
picker, or accounts-subsystem change.

## What was already in main before this branch (prior #3391 groundwork)
- engine/create.js: defaultAgentGrokHome(), grok in isNonClaudeRunner, grok runner
  recording (slot 7), grok model-arm label, exported defaultAgentGrokHome.
- engine/groksession.js: the Grok session reader (board status ring).
- engine/create.js installJob: already refuses a gemini/grok agent at the root.
- engine/connections.js: grok in the "coming soon" provider menu copy.

## Measured grok facts this branch rests on (grok 1.0.41, 2026-09-23)
- Interactive grok skips the OAuth device-auth login with just XAI_API_KEY in the pane
  env ("Logged in with API key"); NO config file is needed to skip login. So there is
  NO auth pre-seed to write (unlike gemini's security.auth.selectedType).
- Native hooks live in $GROK_HOME/hooks/*.json (JSON, wrapped in a top-level "hooks"
  object, "always trusted"), OR in config.toml. There is NO native settings.json;
  ~/.claude/settings.json is read only via claude-compat. So the report hooks go in a
  file WE own: $GROK_HOME/hooks/kosmos-report-bridge.json (never merged into operator
  config).
- GROK_CLAUDE_HOOKS_ENABLED=0 (env) suppresses the fleet ~/.claude hooks via
  claude-compat while OUR native ~/.grok hook still fires (measured). Set at launch.
- --trust grants folder-trust at launch (skips the first-run "trust this directory?"
  gate); the analog of gemini's --skip-trust.
- grok's bash tool is run_terminal_command; brief file is AGENTS.md (native, same as
  codex).
- Hook payload is JSON on stdin with BOTH camelCase and snake_case keys. The bridge
  reads snake_case hook_event_name. Idle last-words come from lastAssistantMessage
  (camelCase in the measured Stop payload; a snake_case fallback is accepted).
- Event -> state map (measured, except StopFailure which is from grok's hooks doc):
  SessionStart->started, UserPromptSubmit->working, Notification->needs_you,
  Stop->idle, StopCancelled->idle, StopFailure->idle, SessionEnd->stopped.
  StopCancelled fires INSTEAD of Stop on interrupt (reason "user_interrupt",
  measured); it MUST map or an interrupted agent shows "working" forever (#249).

## In-scope changes
1. bin/grok-report-bridge.js (new): stdin event -> /api/report, mirror of the gemini
   bridge; STATE_FOR_EVENT above; idle text = lastAssistantMessage; StopCancelled/
   StopFailure -> idle; same identity headers/body (auto:true, pane, agent+board
   token, world header) and never-break-the-agent discipline (exit 0 always).
2. engine/groksettings.js (new): writes our own $GROK_HOME/hooks/kosmos-report-bridge.json.
   Simpler than geminisettings: no auth pre-seed, own file (idempotent-by-content
   overwrite, not a merge), leaves a not-ours file at the path alone, refuses an unsafe
   or ephemeral bridge path or a dangling symlink, preserves mode.
3. engine/runners.js: resolveBin('grok') -- env AGENT_WORKFORCE_GROK_BIN override, else
   legacy /opt/homebrew/bin/grok. No managed rung yet (MANIFEST.grok is a later
   hardening), matching the vendor-external claude/gemini shape.
4. engine/create.js: binPaths().grokBin; provider 'xai'->runner 'grok'->grokBin;
   provider validation accepts xai; grok runner preflight; briefFilename grok->AGENTS.md;
   recordedRunner/setModel agentProvider xai<->grok; free-form grok model arm (default
   null -> supervisor pins grok-4.6); xai=default-account only (configDir stays null);
   grokBridgeSource/grokBridgePath (path.join form -> #731 guard); installSupervisor
   copies+cleans+absent-checks the grok bridge; trustAgentFolder + setAccount guard a
   grok agent out of the CLAUDE path; at birth the grok hook-file write (best-effort,
   non-gating, before bootstrap).
5. bin/agent-supervisor.sh: grok exec arm -- launches with --permission-mode
   bypassPermissions --always-approve --trust -m ${MODEL:-grok-4.6}, and sets
   GROK_CLAUDE_HOOKS_ENABLED=0 in the pane. XAI_API_KEY reaches the pane via the
   existing generic secrets/env door.
6. Staging lists + fixture (the bin-file-staging class the gemini PR closed): the grok
   bridge added to build-kosmos-bundle.sh, build-kosmos-windows.sh,
   deploy/install-board.sh (+ its user-facing say list), tools/test-install.sh
   EXPECTED_ADDS (sorted), and the test-install-board-paths-2870.sh fixture.
7. Tests: grok-report-bridge.test.js (stdin->POST, each state, StopCancelled/StopFailure
   ->idle #249, pane, auto:true #1456, token guards, board token #1968, world header
   #1704, unmapped/garbage/empty -> nothing, exit-0 on down board, snake-case last
   message); engine/groksettings.test.js (the writer + HOOK_EVENTS==bridge keys pin +
   the pure mapping); create.grok cases (launch vector, recorded runner, AGENTS.md
   brief, hook-file write, model accept/refuse, default-account-only, installJob refusal,
   trust/setAccount guards, supervisor flags + GROK_CLAUDE_HOOKS_ENABLED=0);
   runners.test.js resolveBin('grok'); repointed the two runners tests that used grok as
   the unresolvable/unknown example (now resolvable) to mistral.

## Deferred (documented, guarded so nothing mis-launches)
- installJob grok support (backfill/repair/cross-world import): refused cleanly at the
  installJob root today, the same as gemini. Full support is a coupled slice.
- Per-account GROK_HOME (grokaccounts): setAccount refuses grok (default-account only),
  the same boundary as gemini.
- A managed MANIFEST.grok node/tarball install (legacy /opt/homebrew rung ships today).
- A connect-UI / MODELS picker for grok.
- The wiped-~/.grok residual (a launch-time re-apply shim would close it), deferred per
  #3136, the same as gemini's wiped-~/.gemini residual.

## Weakest premise
Two mappings are REASONED, not measured live this session; both are bounded and both
mirror the merged gemini bridge:
- StopFailure->idle is from grok's user-guide hooks doc, not induced live (an API error
  is hard to force). If StopFailure never fires or carries a different name, the only
  cost is that an API-error-ended turn would not report idle (still not wrong --
  Stop/StopCancelled cover the common paths, both measured).
- Notification->needs_you: a Notification under --always-approve/bypassPermissions was
  not induced (benign confirmations auto-approve). The expectation is that a
  Notification that fires is a genuine attention signal, but if grok fires it for an
  auto-approved call it would paint needs_you spuriously. Bounded by auto:true (it can
  never erase a deliberate blocked); a live check is the follow-up.
Everything else (SessionStart/UserPromptSubmit/Stop/StopCancelled, the config/hooks
paths, the api-key login-skip) is measured against the installed grok 1.0.41.
