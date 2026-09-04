# kosmos#2140 Surface 2 — the OpenAI model picker on an existing agent's DETAIL page

## The bug

Josh flagged that an OpenAI agent showed "Claude Sonnet 5" as a selectable model.
#2167 fixed that on the CREATE form. The SAME bug lives on the agent DETAIL page:
`paintModelPicker` renders the change-model `<select>` from `CREATE_MODELS`, which is
the Claude model list (matched by label), so an OpenAI/codex agent's detail page offered
Claude models as switchable options.

## What finished looks like

On an existing OpenAI (`provider === 'openai'` OR `runner === 'codex'`) agent's detail
page, the model box:

- **NEVER shows a Claude model**, in any render state (initial, loading, listable,
  not-listable, fetch-failure).
- **Listable account** (a direct API key that can enumerate `/v1/models`): shows that
  account's chat models with "Let OpenAI choose (recommended)" first and the agent's
  CURRENT model pre-selected (`a.plannedModelName`, which for OpenAI is the raw model id).
  Switch stays disabled until the person picks something other than the current.
- **Not-listable account** (ChatGPT sign-in, no key): a single
  "OpenAI picks its own model for now" option, disabled, with the reason on the message line.
- **Not-ours / never-recorded**: disabled, with an OpenAI-appropriate refusal
  (deliberately NOT the Claude launch-file "Made before Kosmos recorded / cannot change
  what it runs on" copy, which names the Claude Found-agents migration and does not belong
  on an OpenAI panel).

This matches Astra's fuller #2140 spec: Codex = "picks its own model" (correct for the
not-listable path); a Direct-OpenAI API key discovers + picks via `/v1/models`. The fuller
error matrix / "compatibility not verified" / persistence work is downstream of #2129 and
out of scope here.

## The change

- **web/index.html**: new `paintOpenaiDetailModel(a, forWhom)` mirroring the create-form
  `paintOpenaiCreateModel`; `paintModelPicker` delegates to it at the very top (before any
  Claude-model rendering) for openai/codex agents and returns. A generation guard
  (`OPENAI_DETAIL_GEN`) + a flight guard (`CURRENT.sessionName !== forWhom`) reject stale
  and cross-agent fetches. The picker synchronously shows a disabled "Loading…" option
  before its first `await`, so no Claude model can appear even for one frame.
- **server.js**: `GET /api/accounts/openai/models` resolves an EMPTY `dir` to the default
  OpenAI account (a default-codex agent has no configDir, so no dir to name), then re-runs
  the known-account check — stays fail-closed (an undefined default is a 400), and the
  create flow never sends an empty dir so it is unaffected.
- Tests: `web.detail-openai-model-2140.test.js` (jsdom, real function, real fleet cards),
  `docs/browser-checks/render-detail-openai-model-2140.js` (file:// browser check, reds on
  origin/main), `server.openai-models-1026.test.js` (missing-dir now resolves to default),
  `browser-checks-reason-grep.test.js` counts bumped (40→41, 22→23).

## What is NOT in scope

- The fuller Direct-OpenAI discovery picker (error matrix, "compatibility not verified",
  per-agent connectionId+modelId persistence) — Astra's spec, downstream of #2129.
- Any Claude-side model behavior.
- The create form (#2167, already merged).

## Decisions I own (made)

- Empty-dir → default-account resolution rather than a 400, so a default-codex agent (no
  configDir) still gets a picker. Kept fail-closed and re-validated.
- OpenAI-specific refusal copy rather than reusing the Claude launch-file sentences —
  correct for the surface AND un-collides the `web.made-before` copy pins.
- Fixtures built from `test-support/fleet` real cards + spread of the server-emitted OpenAI
  fields (provider/account/plannedModelName/runner all verified producer-emitted), per
  fixture-discipline.

## No open Josh decisions.
