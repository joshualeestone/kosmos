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
1. **engine/runners.js** -- `resolveBin('gemini')` branch: env
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
     non-gating, BEFORE bootstrap -- the analog of preacceptBypass/reporthook).
   - setModel: gemini free-form model arm (mirrors openai) so a model change on a
     gemini agent is not mis-read as a claude model.
3. **engine/geminisettings.js** (NEW) -- one merge-only writer that ensures both
   the auth pre-seed and the five report hooks in `<geminiHome>/settings.json`.
   Same never-clobber discipline as reporthook.js (mode preserved, unparseable
   left alone, ephemeral-into-durable refused, idempotent).
4. **bin/gemini-report-bridge.js** (NEW) -- reads stdin JSON, maps hook_event_name
   to a state, POSTs /api/report with the SAME headers/body shape as
   codex-report-bridge.js (agent-token/board-token/world headers, from_pane,
   auto:true). Never breaks the agent (all failures swallowed, exit 0).
5. **bin/agent-supervisor.sh** -- gemini exec arm:
   `"$CLAUDE" --approval-mode yolo --skip-trust -m "${MODEL:-gemini-2.5-flash}"`.
   The @kosmos_runner=gemini tag is already generic.

## Deferred (documented on the card, out of this coherent unit)
- **installJob gemini support = backfill / repair / adopt / cross-world import.** The
  FULL support is a coherent deferred slice: installJob (create.js) would need geminiBin
  resolution + the birth settings write, worldimport.launchSpecOf a gemini mapping +
  briefFilename, and worldstarts.firstStartOfImport a gemini arm -- all together, or a
  caller records gemini while installJob launches claude. Until then every installJob
  caller is guarded CLEANLY (no reachable path mis-launches a gemini agent as claude):
  - installJob itself now REFUSES a gemini/grok agent at the ROOT (reads recordedRunner),
    so its callers -- register.repair (the live repair route), worldstarts, and
    worldimport -- all inherit a clean "cannot set up a launch job this way yet" refusal.
  - worldimport.copyOne ALSO refuses earlier with an import-specific message (belt and
    suspenders; it avoids the confusing partway brief-read failure).
  ⚠️ CORRECTED PREMISE: an earlier draft deferred the import path as "no gemini agent can
  be imported yet (none exist)". WRONG -- gemini agents are creatable via the server route
  today and ARE offered in the import picker / repairable, so these paths are REACHABLE;
  hence the clean refusals rather than a documented-but-live mis-launch.
- **discover.connect adopting an on-disk GEMINI.md folder.** foundGemini (discover.js,
  merged in #3392) lists a ~/.gemini-brief folder as an adoptable `runner:'gemini'` agent,
  but connect()'s instructions-file loop only tries CLAUDE.md/AGENTS.md, so connecting one
  fails confusingly ("no instructions") or registers it with no runner. PRE-DATES this
  branch (#3392) and needs the same deferred installJob gemini support to actually launch
  what it adopts, so it belongs with this slice. Documented, not fixed here.
- **agent-supervisor.sh CLAUDE_CONFIG_DIR forward.** The `[ "$RUNNER" != codex ]` guard
  (#3417 leak fix) forwards a leaked CLAUDE_CONFIG_DIR into a gemini/grok pane too. Inert
  today (gemini reads no such variable, and a default gemini agent has no configDir), so
  left as-is rather than risk retouching the leak guard for a cosmetic gain; tighten to
  `= claude` if a future runner ever reads that variable.
- **setProvider switching an EXISTING gemini agent AWAY to anthropic/openai.** Not
  blocked (works via the generic path: briefFilename(job.runner) handles the GEMINI.md
  rename and the agent fully converts). Low-risk and left as-is; it leaves the now-inert
  ~/.gemini report hooks behind (a claude agent never reads them) and has no test pinning
  it. Switch-TO-google stays refused (setProvider's provider validation).
- **GEMINI_API_KEY key delivery (the api-key path's precondition).** The birth
  pre-seed makes a launched agent boot straight to the prompt only when a key is in
  the pane env, delivered by the generic `secrets/env/GEMINI_API_KEY` door -- but
  nothing SHIPPED populates that file (no GEMINI_API_KEY token door in
  engine/tokendoors.js, and the connect-UI is deferred). So a fresh `~/.gemini` +
  no key = a silent auth failure. Tracked with the connect-UI/accounts slice: either
  a GEMINI_API_KEY token door (operator pastes a key -> the existing secrets/env
  injection carries it, no full accounts subsystem needed) or the geminiaccounts
  connect flow. NOTE the never-clobber selectedType fix opens a second path: an
  operator who has done their own `gemini` oauth login already has a working session
  in ~/.gemini, and the agent now inherits that (we no longer force api-key), so it
  is functional with no key at all. On THIS box, verification places the key file by
  hand (per Verify by content).
- **agentfile.js geminiIdentity import hint.** The #2410 Gemini-CLI-file import path
  hardcodes `provider: null` with a "re-add when Gemini becomes runnable" note. This
  PR fired that trigger (google is now runnable), but the hint needs the WEB create
  form to have a google option to render into (deferred with the connect-UI slice), so
  it stays null and the comment is updated to say so. Set it to 'google' in the same
  slice that adds the form's google option, so the hint and its target land together.
- MANIFEST.gemini managed node-script install (legacy rung ships now).
- Connect-UI un-gate + MODELS/CREATE_MODELS picker + geminiaccounts subsystem
  (touches web/, per-account homes).
- setProvider switch-to-google (existing agent runner switch).
- observed.js GOOGLE provider + account/liveness badge overlay.
- **Launch-time re-apply of the gemini settings, for the WIPED-~/.gemini case only.**
  The RELOCATION arm is now FIXED, not deferred: create.js bakes geminiBridgePath()
  (the stable supportDir location installSupervisor copies the bridge to on every
  refresh, via geminiBridgeSource()'s guard-visible path.join), so the baked path
  survives an app-tree move exactly as codex's supportDir bridge does, and the bundle
  build ships the bridge by name (#731 guard enforced). The one residual: if someone
  WIPES ~/.gemini, the settings (pre-seed + hooks) are gone until the agent is remade,
  degrading silently to zero reports. The fix is a launch-time re-apply shim in
  agent-supervisor.sh (a gemini-ensure-settings.js analog of ensure-launch-trust.js),
  deferred as a hot-path change of its own per #3136; low-probability (a wiped
  ~/.gemini also loses the whole gemini config, so the agent needs re-setup anyway).

## Verify by content
Whole-tree JS suite green; a new create.gemini + geminisettings + bridge unit
test; then create a real gemini agent on this box, task it via send-keys, watch
it reply and self-report started/working/idle on the board.
