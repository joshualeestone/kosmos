# #5346 part 1: an org chart picture is read by a ChatGPT subscription (Codex), held to "nothing can act"

Branch `codexread-5346`, off origin/main. Card kosmos#5346 (Ice Cream Kitty). Ruling: Splinter 2026-10-05 17:41,
recorded on the card: the promise is "nothing in the chart can trigger an ACTION", not "zero tools"; Codex ships IF
(a) a captured request proves `update_plan` and `request_user_input` are the only tools, (b) `request_user_input`
cannot hang a headless read, (c) the consent box names the provider and account as #4559 does. Antigravity and Grok
stay off (measured reasons on the card).

## Call

- **New reader kind `codex`** in engine/orgchartcodex.js. Order in orgchartfile.currentReader: Claude, then a
  ChatGPT-subscription OpenAI account (openaiaccounts rows with authMode `chatgpt`, default first), then key
  accounts (#4560). A subscription is tried before a key because a key read is billed per call.
- **The run** (flags measured on #5346, codex-cli 0.149.1, the version Kosmos pins in engine/runners.js):
  `codex exec --json --ephemeral --skip-git-repo-check --ignore-user-config --ignore-rules --sandbox read-only
  -C <empty 0700 dir>`, every tool feature `--disable`d, `web_search="disabled"`, `tools.view_image=false`,
  `agents.enabled=false`, `history.persistence="none"`, skills/apps/environment/permissions/collaboration
  instructions off, `project_doc_max_bytes=0`, `model_catalog_json=<derived catalog>`, `--output-schema <file>`,
  the picture with `-i <file>`. CODEX_HOME is the account's folder (unset for the default one, as agents run it).
- **The catalog is derived per read, not shipped.** `model_catalog_json` REPLACES Codex's catalog, and the only
  way to drop `apply_patch` and the code-mode tool is to clear `apply_patch_tool_type` and `tool_mode` on each
  model. The reader copies the account's own `models_cache.json` and clears those two fields, so the catalog
  never drifts from what this Codex fetched. No cache: the read is refused in words (Codex has never run here).
- **Pictures only.** `-i` attaches images; a PDF gets the same "use a picture or an export" sentence as Grok.
- **Answer:** the last `agent_message` in the JSON event stream, parsed and validated by orgchartfile.fromModel.
  **Tripwire:** any event item that is not a message or reasoning (a command, a file change, a tool call, an MCP
  call, a web search) kills the run and refuses the answer. Defense in depth, not the guarantee.
- **Files:** the picture and the schema are written to a fresh 0700 temp folder and removed after the read,
  success or failure. Nothing is saved by Codex (`--ephemeral`, measured on the card).
- **Consent:** "OpenAI (ChatGPT, <email>)", "using your plan", and what OpenAI does with it (orgchartcodex.KEEPS):
  on a personal plan, "Improve the model for everyone" in ChatGPT's Data Controls decides whether it trains on it;
  business plans do not by default (OpenAI's Data Controls FAQ). Codex sends `store: false` (captured). Retention
  is not stated by OpenAI for this path, so it is not claimed. Reader id `codex:<hash of the account folder>`.
- **The schema is the strict one** (orgchartkeys.STRICT_SCHEMA): measured, Codex sends `--output-schema` in OpenAI's
  strict mode, which refuses orgchartfile.SCHEMA ("additionalProperties is required to be ... false").
- **Condition (a) as a test:** `engine/orgchartcodex.capture.test.js` runs the pinned Codex with the real flags
  against a local capture server (`openai_base_url` to 127.0.0.1, answers 400, no subscription used) and fails on
  any function definition other than the two, found by walking the WHOLE request body (Codex puts its tools in a
  developer message, not a top-level `tools`). Control: the same run with the default flags must show `exec`.
  It needs the Codex binary; where none is installed it says so by name, and runs on any Mac with Kosmos's Codex.
- **Condition (b), MEASURED 2026-10-05 17:43, real ChatGPT read, n=2:** a prompt ordering the model to call
  `request_user_input` and wait. Both runs finished in 17.2 s and 14.6 s; the event stream held only
  `agent_message` items (no tool call at all); the model said the tool was unavailable. So in `codex exec` the tool
  is offered but not usable, and nothing waits. The read timeout (110 s, SIGKILL) is the backstop regardless, and a
  unit test proves a hung Codex ends at it.

## Validation so far

- Capture test (real Codex 0.149.1, fake key, local server): 2/2. Mutations, each red for the right reason:
  keeping `tool_mode` -> `exec`, `wait` offered; re-enabling `shell_tool`/`unified_exec` -> `exec_command`,
  `write_stdin` offered. Also captured once with the REAL ChatGPT login (still to a local server): same two tools.
- Unit tests 10/10; existing org-chart tests 138/138; engine sweep tests 128/128.

## Rejected

- **A forwarding proxy that inspects every real request before it leaves.** Strongest check, but the board would
  hold the person's ChatGPT token in flight and re-implement Codex's transport. Apps off is measured, and the
  pinned version plus the capture test cover drift.
- **A checked-in catalog copy.** Drifts with every OpenAI catalog change.
- **Antigravity, Grok.** See the card.

## Weakest premise

That the tools-off state seen in a capture is the state of a real read. Tools Codex loads from OpenAI's servers
(ChatGPT apps) cannot appear in a capture against a local server. With `--disable apps` the real probe on the card
listed only the two, and the tripwire refuses any tool event, but that is one measured run.
