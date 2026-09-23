# Gemini launcher (kosmos#3296, slice 3)

## Goal
Make a **default-account, model-pinned Gemini agent** creatable in Kosmos: it
spawns via the create path, receives tasks by send-keys, and self-reports its
lifecycle to the board WITHOUT any pane scraping (the #3296 core question). Grok
reuses all of it later.

Additive only: an anthropic/openai create must stay byte-identical. No web/,
no MODELS/picker, no accounts subsystem. Full challenge-loop, verify by content.

## Proven-live facts (do not re-litigate; measured this night, see #3296 comments)
- Gemini CLI installed at `/opt/homebrew/bin/gemini` (shebang node script, exec
  bit -> passes runners.isRunnable, like codex's symlink).
- Gemini API key vaulted (secrets-map target `gemini`), live round-trip OK
  (gemini-2.5-flash).
- Integration = a mirror of the CLAUDE HOOK path: gemini-cli has its own hook
  system in `settings.json` (schema identical to Claude Code:
  `hooks.<Event>: [{ hooks: [{type:'command', command:'<shell>'}] }]`).
- Hook input arrives on **stdin** as JSON (not argv like codex):
  `{session_id, transcript_path, cwd, hook_event_name, timestamp, ...per-event}`.
  Verified in the bundle executor (spawns a shell, writes JSON.stringify(input)
  to stdin, inherits process.env unchanged by default).
- Event -> state map (per-event payloads confirmed in the bundle):
  - SessionStart `{...,source}`            -> started
  - BeforeAgent  `{...,prompt}`            -> working (turn start)
  - Notification `{...,notification_type,message,details}` -> needs_you
    (fires only when a tool needs confirmation; under `--approval-mode yolo`
    that is suppressed, so a Notification is a genuine "yolo could not
    auto-handle" attention signal; message satisfies the reason requirement)
  - AfterAgent   `{...,prompt,prompt_response,stop_hook_active}` -> idle
    (turn complete; prompt_response is the card text)
  - SessionEnd   `{...,reason}`            -> stopped
- Auth pre-seed: `{"security":{"auth":{"selectedType":"gemini-api-key"}}}` in the
  agent's gemini settings.json + GEMINI_API_KEY in env -> boots straight to prompt.
- Model: pin `-m gemini-2.5-flash` ("Auto" router hangs in a tmux pane).
- GEMINI_API_KEY reaches the pane via the GENERIC secrets/env door (supervisor
  auto-injects any `secrets/env/<VARNAME>`), so NO supervisor/tokendoors edit for it.

## Changes (all additive, beside the existing codex/claude arms)
1. **engine/runners.js** — `resolveBin('gemini')` branch: env
   `AGENT_WORKFORCE_GEMINI_BIN` -> legacy `/opt/homebrew/bin/gemini`. (Managed
   MANIFEST install is a later hardening; the legacy rung mirrors how codex
   resolves on this box today.)
2. **engine/create.js**
   - binPaths: add `geminiBin`.
   - briefFilename: gemini -> `GEMINI.md` (gemini-cli's context file).
   - recordedRunner + agentProvider: profile provider `google` <-> runner `gemini`.
   - createAgentInner: destructure geminiBin; provider->runner->runnerBin gemini
     arm; provider validation accept `google`; gemini runner preflight; model
     block gemini free-form arm (default null -> supervisor pins); account block
     google = default-account only (configDir stays null); AT BIRTH write the auth
     pre-seed + report hooks into the gemini home settings.json (best-effort,
     non-gating, BEFORE bootstrap — the analog of preacceptBypass/reporthook).
   - setModel: gemini free-form model arm (mirrors openai) so a model change on a
     gemini agent is not mis-read as a claude model.
3. **engine/geminisettings.js** (NEW) — one merge-only writer that ensures both
   the auth pre-seed and the five report hooks in `<geminiHome>/settings.json`.
   Same never-clobber discipline as reporthook.js (mode preserved, unparseable
   left alone, ephemeral-into-durable refused, idempotent).
4. **bin/gemini-report-bridge.js** (NEW) — reads stdin JSON, maps hook_event_name
   to a state, POSTs /api/report with the SAME headers/body shape as
   codex-report-bridge.js (agent-token/board-token/world headers, from_pane,
   auto:true). Never breaks the agent (all failures swallowed, exit 0).
5. **bin/agent-supervisor.sh** — gemini exec arm:
   `"$CLAUDE" --approval-mode yolo --skip-trust -m "${MODEL:-gemini-2.5-flash}"`.
   The @kosmos_runner=gemini tag is already generic.

## Deferred (documented on the card, out of this coherent unit)
- **worldstarts.js / installJob cross-Kosmos gemini import.** Attempted a
  worldstarts firstStartOfImport gemini arm, then REVERTED it: installJob
  (create.js) only recognises runner 'codex' (line ~2776, `opts.runner === 'codex'
  ? 'codex' : null`) and resolves claudeBin for anything else, so passing
  runner:'gemini' through worldstarts would be half-wired (worldstarts records
  gemini, installJob launches claude). Making it fully correct needs installJob
  itself to grow a gemini arm (geminiBin resolution + the birth settings write),
  which is its own coherent slice. Left byte-identical rather than half-wired; no
  gemini agent can be imported yet (none exist, and import is same-machine
  cross-world), so the path is dead for gemini today.
- MANIFEST.gemini managed node-script install (legacy rung ships now).
- Connect-UI un-gate + MODELS/CREATE_MODELS picker + geminiaccounts subsystem
  (touches web/, per-account homes).
- setProvider switch-to-google (existing agent runner switch).
- observed.js GOOGLE provider + account/liveness badge overlay.
- Supervisor restart re-apply of gemini settings (persists across normal
  restarts; only a wiped ~/.gemini would lose hooks).

## Verify by content
Whole-tree JS suite green; a new create.gemini + geminisettings + bridge unit
test; then create a real gemini agent on this box, task it via send-keys, watch
it reply and self-report started/working/idle on the board.
