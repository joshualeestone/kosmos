# Plan: #3459, add Opus 5.5 to the Anthropic model picker

Branch: `opus55-picker-3459` · Repo: joshualeestone/kosmos · Lane: engine / model config

## The card
Josh (2026-09-23): add Opus 5.5 as a selectable Anthropic model in the create/reassign model
picker. Keep the existing ones (Opus 4.8, Opus 5.0, Fable 5.1) and add 5.5, alongside the
other providers. Confirm the exact Opus 5.5 model id against Anthropic's current list rather
than guess it.

## What "done" looks like
Opus 5.5 appears in the model picker (create form + reassign), and a spawned/reassigned agent
selecting it launches on `claude-opus-5-5`.

## Model id (confirmed, not guessed)
`claude-opus-5-5` (no date suffix), confirmed against the claude-api skill's current model
table (the designated Anthropic model reference) and consistent with the existing pattern
(`claude-opus-4-8`, `claude-opus-5`, `claude-fable-5-1`).

## What changed (two coupled indices + the tests that pin them)
1. `engine/create.js` MODELS array: added `{ key: 'opus55', provider: 'anthropic', label:
   'Claude Opus 5.5', arg: 'claude-opus-5-5', why: ... }`, placed ahead of Opus 5 per the
   most-powerful-first order (Opus 5.5 succeeds Opus 5). The array order IS the picker's
   display order. The default stays Sonnet 5.
2. `engine/status.js` MODEL_NAMES: added `'claude-opus-5-5': 'Claude Opus 5.5'`, so a running
   5.5 agent is named rather than shown its raw id. This is the same picker->name pairing the
   existing Fable 5.1 entry documents, and it satisfies the create.test.js name cross-check.
3. `engine/create.test.js`: updated the two tests that pin the list (they are meant to be
   updated deliberately when the list changes): #1026 anthropic count 6 -> 7, and #2140 the
   exact most-powerful-first order (inserted `claude-opus-5-5` ahead of `claude-opus-5`).

## Verification
- `engine/create.test.js` 165/165 (this run). Covers: #1026 count, #2140 order, the
  menu-vs-board name cross-check (`modelDisplayName('claude-opus-5-5')` == 'Claude Opus 5.5'),
  and the existing `for (const m of create.MODELS)` round-trip test, which creates an agent on
  every model key (now including opus55) and asserts it launches with `m.arg` through the real
  job file, so "launches on Opus 5.5" is proven by existing coverage.
- `engine/status.test.js` 193/193.
- Web picker tests (picker-provider, change-dialog, create-prefs, detail/picker-openai-model,
  runs-on, made-before) 42/42, so the picker render surfaces do not pin a model count that the
  addition breaks. The picker is data-driven from MODELS via the /api route (server.js:4386)
  and is theme-agnostic per model, so light/dark is the existing theme handling.
- Coupled-index audit (there were FOUR surfaces; my first grep sweep was under-scoped and
  missed the derived-order test, which the full `yarn test` run and the iteration-1 review both
  caught):
  1. `engine/create.js` MODELS array (updated).
  2. `engine/status.js` MODEL_NAMES (updated).
  3. `engine/create.test.js` #1026 count + #2140 order (updated).
  4. `engine/model-sort-order-2284.test.js` #2284 order (updated). This one derives the order
     from `create.MODELS.filter(...).map(...)` and deepEquals a hardcoded list, so it is neither
     a literal "count" nor a verbatim list and my count/list grep missed it.
  5. `web/index.html` USAGE_MODEL_PRICES (the #2840 token-cost map): NOT updated, deferred to
     fast-follow #3460. Per the map's NO-GUESSING rule an unpriced model is excluded from the
     cost figure and named in `unpriced` (graceful, not a crash); Opus 5.5 is a launching model
     whose price may shift and whose cache-write field is only derivable, so it is deliberately
     left unpriced here.
  Context limit is covered by the ASSUMED_LIMIT_MODELS regex (`/^claude-(opus|sonnet|fable)-/`
  matches `claude-opus-5-5`). Model tests after the fix: create.test.js + status.test.js +
  model-sort-order-2284.test.js = 361/361.

## Weakest premise (named)
That `claude-opus-5-5` is the exact, current id and that Opus 5.5 belongs ahead of Opus 5 in
the order. The id is confirmed against the claude-api reference and the naming pattern; the
placement is a documented most-powerful-first convention call (Opus 5.5 succeeds Opus 5), a
one-line move if a reviewer prefers otherwise. Not in scope, noted as possible fast-follow:
per-model usage-cost pricing (`usageModelPrice`) for a running Opus 5.5 agent, which is the
token-usage display feature, not the picker.
