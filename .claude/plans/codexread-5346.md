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
  the picture with `-i <file>`. CODEX_HOME is always set to the account's folder (for the default account that is
  the folder Codex reads anyway). The rest of the environment is an ALLOWLIST (orgchartcodex.childEnv): what a
  program needs to run, plus the person's proxy and CA settings, without which a company network cannot reach OpenAI.
  No key, board token, base URL or NODE_OPTIONS reaches Codex.
- **Codex runs in its own process group** (not on Windows) and every ending kills the group. Measured in review:
  `/opt/homebrew/bin/codex` is an npm launcher whose native child survives a SIGKILL to the launcher; the group kill
  removes both (measured on the real binary).
- **The catalog is derived per read, not shipped.** `model_catalog_json` REPLACES Codex's catalog, and the only
  way to drop `apply_patch` and the code-mode tool is to clear `apply_patch_tool_type` and `tool_mode` on each
  model. The reader copies the account's own `models_cache.json`, which OpenAI's servers write and refresh, so it is
  NOT trusted: every field that can switch a tool on is forced off (orgchartcodex.FORCED: both tool fields null,
  `experimental_supported_tools` empty, `node_repl_disabled` true, `supports_search_tool` false, the three
  usage-instruction flags false, `multi_agent_version` removed), and a cache written by another Codex version, or
  with a field 0.149.1's catalog does not have, is refused (fails closed). No cache: refused in words.
- **Codex runs with an empty home of its own** (HOME, and USERPROFILE on Windows), inside the read's temp folder:
  nothing under the person's home (their ~/.agents skills and plugins) can load. Measured: a real ChatGPT read signs
  in from CODEX_HOME alone and writes nothing there.
- **A computer with administrator-managed Codex settings is not used** (`/etc/codex`, or a com.openai.codex
  managed-preferences profile): those layers may not be covered by `--ignore-user-config` and could add a tool.
  Windows: no such layer is known, so none is checked; a stated gap.
- **Pictures only.** `-i` attaches images; a PDF gets the same "use a picture or an export" sentence as Grok.
- **Answer:** the last `agent_message` in the JSON event stream, parsed and validated by orgchartfile.fromModel.
  **Tripwire:** any event item that is not a message, reasoning, a to-do list (what update_plan produces) or an error
  item (a command, a file change, a tool call, an MCP call, a web search, anything new) kills the run and refuses
  the answer. Defense in depth, not the guarantee. A turn.failed refuses the answer even after a message; a top-level
  error (Codex reports a reconnect this way) refuses it only if no turn.completed follows.
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
  any function definition other than the two, ON EVERY MODEL in the catalog (a read runs on whichever one Codex
  picks, and each model carries its own tool fields), found by walking the WHOLE request body (Codex puts its tools in a
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
- Unit tests 19/19 after iteration 5; existing org-chart tests and engine sweeps pass in the same run. Each guard
  added in review was checked by a mutation that reds it (group kill, env allowlist, instructions file, failed turn,
  forced catalog field).

- **Two fail-closed gates before the reader is offered** (and the first again at the read):
  1. **The account has its own instructions file** (`AGENTS.override.md` or `AGENTS.md` in its Codex folder): not
     used, with a sentence saying why. Measured in review: Codex sends that file with every request under every flag,
     `model_instructions_file` included, so it would carry the person's private instructions to OpenAI and could
     steer the read. Kosmos does not write these files (engine/personalinstr.js). A capture test pins the premise.
  2. **The Codex binary is not the version Kosmos pins** (runners MANIFEST, 0.149.1): not used. The flags and the
     catalog clearing were measured on that version only; a newer one could add a tool that is on by default.

## Rejected

- **A separate Codex home per read without the instructions file.** A ChatGPT token refreshed into the copy could
  invalidate the person's real sign-in, and their agents with it.

- **A forwarding proxy that inspects every real request before it leaves.** Strongest check, but the board would
  hold the person's ChatGPT token in flight and re-implement Codex's transport. Apps off is measured, and the
  pinned version plus the capture test cover drift.
- **A checked-in catalog copy.** Drifts with every OpenAI catalog change.
- **Antigravity, Grok.** See the card.

## Weakest premise

That the tools-off state seen in a capture is the state of a real read. Tools Codex loads from OpenAI's servers
(ChatGPT apps) cannot appear in a capture against a local server. With `--disable apps` the real probe on the card
listed only the two, and the tripwire refuses any tool event, but that is one measured run. Second: that the layers
checked are all the context Codex loads. Measured as not sent under the flags: the account's config, skills, prompts,
memories, rules and hooks (capture test, with a control). The system and managed layers are refused rather than
measured, and Windows has no such check.
