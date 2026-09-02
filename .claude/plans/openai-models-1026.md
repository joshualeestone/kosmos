# #1026 (engine half) - the OpenAI side of the model picker, sourced from /v1/models

## Problem (from the card)

The create screen's model picker is served one static list (`create.MODELS`), four
Anthropic entries. A GPT agent is therefore offered four Claude models. The engine
half of #1026 landed the provider-awareness mechanism (#1111: every row carries a
`provider`), but every row is still `provider: anthropic`, so there is nothing to
filter TO on the OpenAI side. This branch populates the OpenAI side.

The card's central rule: **do not hardcode GPT names.** A wrong model name is not
cosmetic, it is an agent that fails to start. The list of models an account can use
is already fetched by `engine/openaiaccounts.js` (`GET /v1/models`, `askModels`) on
every key check and discarded. The OpenAI rows must come from that.

## What this branch is, and is not

- **Is:** the engine capability to turn an OpenAI account's `/v1/models` into a
  provider-aware chat-model menu (ids sourced from the account, filtered to chat
  families, a default, `why` copy), plus a route that serves it on demand.
- **Is not:** the create screen's picker filtering (the card assigns the screen half
  to Mona Lisa), and it is not the create-time VALIDATION of an OpenAI model against
  this dynamic list. See "What remains" - the validation interlocks with #979's
  connect flow (creating a GPT agent "has not yet been a normal thing to do").

## Decisions (mine, per the standing night-shift rule; the card marked the
   curated-vs-all question as Josh's, and the rule is: decide, implement, document)

1. **Source every id from the account's `/v1/models`; never hardcode a name.** The
   `arg` a runner launches with is always an id OpenAI just told us the key has.
2. **Filter is two-sided and the safety order is deliberate** (`chatModelsFromList`):
   - an ALLOWLIST of chat families by id prefix (gpt-5, gpt-4.1, gpt-4o, chatgpt,
     o1, o3, o4, plus the bare `gpt-4` catch-all and `codex` — the latter two
     added in iteration 1 so legacy gpt-4/gpt-4-turbo and the codex runner's own
     codex-mini are offered). A new chat family with an unknown prefix is missed
     until the list learns it - an UNDER-offer, invisible and safe.
   - a DENYLIST of non-chat variants within those families (audio, realtime,
     transcribe, tts, search, image, embedding, moderation, whisper, dall-e,
     instruct), because `gpt-4o-audio-preview` etc. are gpt-4o-* by prefix but
     not chat models, and `gpt-3.5-turbo-instruct` is a completions model.
     `search` also drops the web-search-preview and deep-research variants.
   The card explicitly calls filtering "part of the work"; this is it.
3. **A curated chat menu, not the account's entire `/v1/models`.** That endpoint
   returns embeddings/tts/image/etc.; showing all of it is the fail-to-start failure
   the card names. Josh's example (agents named individually, same model underneath)
   leans to a short menu. The "more models" escape, if wanted, is a SCREEN concern
   (Mona Lisa's) - the engine returns the filtered chat set, ranked most-capable
   first, so the screen can show a head + "more" without the engine deciding UX.
4. **Default = the most capable non-lite row present** (not -mini/-nano/-preview),
   else the first - chosen among what the account has, never invented.
5. **`why` lines are copy keyed by family**, with the arg/id always from the account.
6. **Served on demand, per account, via `GET /api/accounts/openai/models?dir=<dir>`**,
   NOT through the static account-agnostic `/api/roles` list - because the OpenAI
   list is per-account and async (a live fetch with that account's key). The route
   guards which account may be asked about (resolved-path match against the
   enumerated list; fail-closed), then calls `openaiaccounts.accountModels(dir)`.

## Rejected

- **Returning the whole `/v1/models`.** Includes non-chat models that fail to start.
- **Merging OpenAI rows into the static `create.MODELS` / `/api/roles`.** That list is
  synchronous and account-agnostic; the OpenAI set is neither.
- **An over-broad exclude-only filter.** A new non-chat family with an unknown name
  would slip through and be offered (fail-to-start). Allowlist-first takes the safe
  error (miss a new chat family) over the dangerous one.

## What landed

- `engine/openaiaccounts.js`: `chatModelsFromList(data)` (pure) + `accountModels(dir)`
  (async: same key-read + honest-answer discipline as `checkLive`; absent /
  unreadable / non-apikey / unreachable / non-200 / no-chat each answer with a plain
  sentence, never a misleading empty menu). Both exported.
- `server.js`: `GET /api/accounts/openai/models?dir=<dir>` - known-account guard then
  `accountModels`, never 500s.
- Tests: `engine/openaiaccounts.test.js` (+8 arms incl. a CONTROL that an
  all-non-chat list yields an empty menu, so the filter is not vacuously passing),
  `server.openai-models-1026.test.js` (+4 arms incl. a CONTROL that an unknown dir is
  404'd before any fetch).

## What remains (documented, not silently dropped)

- **The create screen's picker** consuming this route and filtering by provider -
  Mona Lisa's, per the card. Contract for her: `GET /api/accounts/openai/models?dir=`
  -> `{ ok, models: [{key, provider, label, arg, why, default}], because? }`, same
  row shape as `/api/roles`' Claude rows. A HEADS-UP will carry this.
- **Create-time validation of an OpenAI model** against this dynamic list.
  `create.modelFor('openai', key)` still returns null (the static MODELS has no
  openai rows), so an OpenAI agent cannot yet be created WITH a chosen model. Making
  that work is the async ripple through `createAgentInner`, and it interlocks with
  #979's connect flow (the card notes GPT-agent creation "is not yet a normal thing
  to do"). Flagged on the card as the next step.

## Weakest premise

The chat-family allowlist could exclude a brand-new OpenAI chat family until the
prefix list is updated. This is chosen on purpose: an under-offer is invisible and
harmless, while the opposite error (offering a non-chat model) is the fail-to-start
this card exists to prevent. The `why` copy is family-keyed and may not perfectly
describe a specific variant; it is a business-person hint, not a spec.
