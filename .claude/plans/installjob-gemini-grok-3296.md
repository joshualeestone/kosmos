# installJob: back-fill / repair / import a Gemini or Grok agent's launch job (#3296 / #3391)

## The gap

`installJob` is the adopt / backfill / repair / cross-world-import path (as opposed to
`createAgentInner`, which writes its own plist at birth). Today it **refuses gemini/grok at
the root** on every platform, with a deliberate comment: the runner it hands `plistFor` is
`(opts.runner === 'codex') ? 'codex' : null`, so without the refusal a gemini agent whose
plist went missing would be **re-installed as a CLAUDE job with claudeBin** -- a silent
mis-launch. The refusal was the safe placeholder until this backfill slice.

So an agent CREATED on Gemini/Grok cannot currently be repaired ("Set them to start at
login"), adopted, or imported into another world -- `register.repair`, and
`worldstarts.firstStartOfImport` all inherit the root refusal.

## Why all three callers move together

The refusal is a SINGLE inheritance point. Lifting it in `installJob` alone would let the
import path reach the new support while `worldstarts` still collapses a gemini/grok entry to
`runner = 'claude'` and writes a Claude `.claude.json` trust file for it -- i.e. it would
re-introduce the exact silent mis-launch the refusal prevented, one caller over. So the
coherent, safe unit is: make `installJob` derive the runner correctly, and fix every caller
that would then reach it.

## Design

### engine/create.js `installJob`
1. Compute `wantRunner = opts.runner || recordedRunner(clean)` ONCE (it already exists for
   the refusal check). Use it for BOTH the refusal and the plist write.
2. The plist `runner`/`runnerBin` derive from `wantRunner`: codex->codexBin, gemini->geminiBin,
   grok->grokBin, else claude/claudeBin (via the shared `binPaths`). This is the fix that
   stops the mis-launch: the runner written to the plist is the agent's TRUE runner
   (recordedRunner reads plist-then-profile.provider), never silently claude.
3. Lift the root refusal from all-platforms to **win32-only**: `engine/win32launch.js` has no
   gemini/grok substrate (`win32StartViaJob` only knows codex/claude), and I have no Windows
   box to build or test it, so a gemini/grok backfill on win32 stays refused with a clear
   "cannot set up a launch job for this way yet" sentence. On Mac it proceeds. The win32
   refusal sits BEFORE the win32 launch arm, so win32 never reaches `win32StartViaJob` with
   gemini/grok.
4. The runner-not-found refusal names the runner (Gemini/Grok), mirroring codex/claude.
5. configDir for a backfill: unchanged. Callers pass none, so it defaults to null (the
   env-key default door), which `plistFor` writes as an absent GEMINI_CLI_HOME/GROK_HOME --
   the same "default door" a created default-account agent gets. A repair does not try to
   recover a prior named account (it is not in opts and the plist that held it is gone);
   defaulting to the door is the safe, correct backfill behavior, symmetric with the codex
   backfill which also does not recover a prior CODEX_HOME.

### engine/register.js `repair`
Pass the runner explicitly for google/xai, mirroring the existing `provider === 'openai' ->
runner: 'codex'` arm: `google -> 'gemini'`, `xai -> 'grok'`. installJob would resolve the
same value via `recordedRunner` even if repair passed nothing (the plist is missing during a
repair, so recordedRunner falls to profile.provider), but passing it explicitly is robust
against an unreadable profile and matches the codex arm's shape.

### engine/worldstarts.js `firstStartOfImport`
1. Pass `entry.runner` through for gemini/grok instead of collapsing to claude: today
   `const runner = entry.runner === 'codex' ? 'codex' : 'claude'` maps a gemini entry to
   claude. Resolve it to the real runner and pass it to installJob.
2. Skip the Claude `trust.trustFolder` pre-answer for gemini/grok: that writes a Claude
   `.claude.json` trust entry, which is the wrong tool's config for a gemini/grok agent
   (they clear their own folder-trust at launch via agent-supervisor.sh, per #3296/#3391).
   The trust pre-answer stays for claude only. This is the same "wrong-tool's-config" class
   createAgentInner guards at birth.

## What I rejected
- Lifting installJob's refusal alone and carding the import path: rejected. It re-introduces
  the silent mis-launch (worldstarts would collapse gemini->claude) that the refusal existed
  to prevent -- strictly worse than the current clean refusal.
- Windows (win32launch) gemini/grok support: rejected for this card. No Windows box to build
  or test the substrate; the win32 refusal is preserved and the Windows backfill is carded.
- Recovering a repaired agent's prior named account: rejected. It is not in opts and the
  plist that held it is gone; defaulting to the env-key door matches the codex backfill.

## Weakest premise
That an imported/repaired agent's `profile.provider` (or `entry.runner`) reliably names
gemini/grok by the time installJob runs. If a profile is unreadable, `recordedRunner` floors
at claude -- the pre-existing behavior for every provider, and the same floor the codex
backfill has. register.repair passing the runner explicitly (from the same profile read)
does not remove that floor; it just makes the common path explicit. A backfill onto the
wrong runner is recoverable in one click (the never-overwrite `already === 'yes'` guard
means a second repair does not double-launch); no backfill at all is not.

## Tests
New `engine/create.installjob-gemini-grok-3296.test.js`: installJob writes a gemini plist
(runner gemini, geminiBin, GEMINI_CLI_HOME absent for the default door) and a grok plist for
an agent whose recorded runner is gemini/grok; the win32 arm still REFUSES gemini/grok with
the clear sentence; a missing gemini runner is refused naming Gemini; the never-overwrite
guard still fires. Plus caller coverage: register.repair passes the right runner for a
google/xai profile, and worldstarts.firstStartOfImport installs a gemini entry as gemini and
does NOT write a Claude trust file for it. Existing installJob tests (codex/claude backfill,
win32 double-launch guard #570, #1159 runner-binary gates) must stay green.
