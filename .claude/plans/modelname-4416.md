# modelname-4416: every agent's actual model, in plain language

## Why
Josh 2026-09-28 15:17: Gemini agents read the raw "gemini-3.8-flash"; 15:18: Grok reads only "Grok" though it runs
Grok 4.6, "not as helpful as knowing what actual model these things are on". Read it from what Kosmos can see, never
by asking the agent.

## Call
- engine/status.js modelDisplayName: the table first (unchanged), then readableModelId: an unknown id is read in plain
  language (Gemini 3.8 Flash, Grok 4.6, GPT 5.6 Sol) UNLESS reading it could mis-say a version: two number-only parts
  side by side (claude-opus-6-1) or a date part stay raw. That is the hazard the table's own comment names ("Haiku 4 5").
- The card's model per runner, from each CLI's own record: agy conversation, Gemini session (per message), Grok
  current_model_id, Codex turn_context (new: engine/codexsession.js returns `model`), else the Claude transcript.
- Before a first turn: a job's own model wins on BOTH platforms (plannedModelArg reads plists only; readJob also
  reads a Windows Scheduled Task). A Gemini/Grok job with no recorded model names the launcher's pinned default,
  "(default)" (win32keyed.DEFAULT_MODEL, the one table; the test holds bin/agent-supervisor.sh equal to it).
- A stopped agent's "Will start on" keeps its runner, so a stopped Gemini/Grok/Codex is never "Claude <model>".
- Page: Codex names its model ("OpenAI Codex" only while none is known). The OpenAI picker's current choice reads a
  new raw `plannedModelId` (codex only), because plannedModelName is now a readable name no option value matches.

- Review iteration 3: create.plannedModelOf reads the job ONCE ({ id, isDefault }), tested against real launch files
  written by plistFor in a sandbox (Claude none, Gemini/Grok pinned default, a chosen model kept, Codex none). The
  Gemini/Grok model menu now says "Runs on <the card's model>" and the switch dialog "starts on Kosmos's default
  <provider> model" instead of "picks its own model", which stopped being true once Kosmos passes -m. Antigravity
  and Muse still say "picks its own", because they do. A bare codex model reads "OpenAI o3".

- Review iteration 4: the Gemini/Grok menu read `modelName || plannedModelName` while the card prefers the job for a
  stopped agent, so a stopped Gemini that last ran Pro said "Runs on Gemini 3.8 Pro" beside a card saying "Gemini 3.8
  Flash (default)". Now the menu reads the card's own line: menuRunsOn returns modelLine(a) (defined after it; modelLine
  stays self-contained because several tests lift it alone). A behavioural test lifts both; reverting menuRunsOn to
  the old expression reds it.
- Review iteration 5: (a) my iteration-4 helper made modelLine call a new function, and 7 tests in 4 files that lift
  modelLine alone threw ReferenceError; fixed as above, all four files green. (b) Codex writes its rollout LAZILY, on
  the first turn (MEASURED: codex-cli 0.149.1 idle at its prompt 30 s in a sandbox CODEX_HOME, no rollout), so right
  after Kosmos switches a Codex agent's model the newest rollout is the old session's and names the old model.
  status.readCodexSession now drops the model of a rollout last written before the job file (setModel rewrites it);
  the card falls back to the planned model. Mac only; an account change drops it too (costs "OpenAI Codex" until the
  next turn, never a wrong name). Tested with set mtimes in a sandbox; disabling the guard reds the switched case. DEFERRED (cosmetic): ids outside MODEL_WORDS keep simple
  casing ("Chatgpt 4o Latest", "GPT 5.6 mini"); no version is mis-said.
## Rejected
- A pure dash-to-space transform for every id: "Claude Haiku 4 5" on the next dashed version.
- Asking agents to report their model: self-report is unreliable (the card says so).

## Not done
- Muse: it picks its model per turn and records none Kosmos can read; it still shows the provider.
- The usage-history list (Settings) keys rows by raw id; it is a cost ledger, left as is.

- The Windows arm (job.model from the Scheduled Task, plannedModelId's fallback) is REASONED from readJob's win32
  shape, not driven: no test here injects a task spec. The Mac arm is unchanged in value.

## Known differences, by design
- A running Codex agent's card names the model its rollout reports; the OpenAI picker pre-selects the JOB's model
  (plannedModelId), because the job is what the picker changes. After a /model switch inside codex they can differ
  until the agent restarts.
- The stopped list reads plannedModelId only for codex rows, as the roster does (one launch-file read, not three).

## Weakest premise
That each CLI's record names the model it runs NOW: Codex's last turn_context and Grok's current_model_id do; Gemini
names it per message, so a /model switch shows after the next reply, not at the switch.
