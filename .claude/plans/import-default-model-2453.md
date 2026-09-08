# import-default-model-2453: default an imported agent to a model

Josh, 0.6.47 re-test: imported agents show 'unknown model' + not reachable; one read "provider Claude,
unknown model". Fix: default an imported agent to a sensible base model of its provider, so it lands
ON a model before the first message. Splinter routed; engine default-on-import is mine, model DISPLAY
is Angel's.

## Root cause (traced on origin/main)
Import PARSES a `.md` (agentfile.importAgent -> {name, displayName, provider, body}, provider inferred
from the file) and PRE-FILLS the create form (server.js `/api/agent-import`), which submits to
createAgent. The parse response carried NO model, and the form could submit no model key, so
createAgentInner reached its model block with `wantModelKey` undefined -> `modelArg` null -> a Claude
agent launched with no `--model` -> the board shows 'unknown model'.

## Why NOT a central default in createAgentInner (an approach tried and reverted)
The obvious fix -- default `modelArg` to the provider default in createAgentInner when none is given --
is WRONG. `engine/create.test.js` ('the model choice writes a sixth supervisor argument, and no choice
writes the five every existing agent runs') DELIBERATELY asserts that a no-model create carries NO
model flag: an agent created without a choice runs on the runner's own default, the 5-argument shape.
That is an intended state, not the bug. Defaulting centrally broke 3 tests and would change how every
no-model agent launches, far beyond the card's default-on-IMPORT scope.

## The fix (import-scoped, engine side)
`engine/create.js`: a `defaultModelKeyFor(provider)` helper returns the KEY of the provider's
`default: true` model (the same one the form pre-selects, single-sourced so the import default cannot
drift from the picker). Anthropic/'claude' -> 'sonnet'; a null/absent provider -> 'sonnet' (the
connected-Claude case an unrecognized .md hits); OpenAI -> null (no static models; codex picks its
own, the intended state, so an openai import carries no model key -- its 'unknown model' is a DISPLAY
concern, Angel's).

`server.js`: both `/api/agent-import` parse routes now return `model: create.defaultModelKeyFor(parsed.provider)`
in the pre-fill material. So the import-prefilled create form has a model to pre-select and submit,
and the created agent lands on that model instead of being model-less.

## The Angel seam (display side)
I provide `model` (a model KEY) in the parse response. Angel's create form must READ `parsed.model` and
pre-select the model picker with it, so the value flows to the POST /api/agents submission. Told her.
The engine default cannot land the model on its own -- it feeds the form, which Angel owns.

## Decision: "sensible base (mid/low)"
Used the provider DEFAULT (Sonnet 5, `default: true`) -- the established pre-selected default; reusing
it avoids a second default that drifts from the picker. Josh said "mid/low"; Sonnet is mid. Haiku
(low/cheapest) is a one-line change (point the helper at haiku, or a separate import default) if he
prefers it for imports. Documented on the card.

## Tests
- engine/create.test.js: `defaultModelKeyFor` unit -- sonnet for anthropic/'claude'/null, null for openai.
- server.agent-import-1652.test.js: a Claude export import returns model 'sonnet'; a raw provider-less
  CLAUDE.md import returns 'sonnet'. Both perturbation-verified (nulling the helper reds them). The
  openai-route case is covered by the unit + the route's uniform helper call (a codex AGENTS.md export
  fixture is out of scope).

## Validation
Fast: `node --test engine/create.test.js server.agent-import-1652.test.js`. Full suite via the box at
merge time (hold during a release cut).
