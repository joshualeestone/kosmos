# Plan: let users pick the OpenAI model when creating an agent (#2140, create flow)

## Context
Card #2140 "Let users pick the OpenAI model" revisits the #245 boundary ("OpenAI picks its
own model for now"). Feasibility (mine) + design (Mona Lisa) are both on the card. The hard
parts were already built: `codex -m <MODEL>` (supervisor) through the plist model slot, and
#1026's `accountModels(dir)` (a per-account filtered /v1/models list) served at
`GET /api/accounts/openai/models`. OpenAI models are PER-ACCOUNT/dynamic (key===arg===the id),
not the static `MODELS` list.

## Scope
This branch is the CREATE flow. The detail-page change-model picker for an existing OpenAI
agent (Surface 2) is a deliberate fast-follow: it needs the OpenAI agent's current model
exposed in /api/status first (today `modelLine` returns "OpenAI Codex" for codex agents; #246
does not scrape the model). This PR does not touch `paintModelPicker`, so it does not worsen
the detail page for OpenAI agents.

## Changes
- **Engine (create.js)**: lift the #245 refusal. `createAgentInner` + `setModel` accept an
  OpenAI model as the `-m` arg (empty = "Let OpenAI choose" = auto = empty slot), sanity-bounded
  (`/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/`) with a sync cross-vendor guard (a Claude model key OR
  arg is refused, no network). The auto choice carries a real label ("OpenAI's default").
- **Server (server.js)**: the create route + change-model route validate a CHOSEN OpenAI model
  against `accountModels(dir)` (async). Only a DEFINITIVE listable-mismatch refuses; empty is
  skipped; any uncertainty fails open (#1916). Dir = body.account | defaultDir() (create) or the
  agent's own readJob().configDir | defaultDir() (change).
- **Create UI (web/index.html)**: `applyCreateProviderUI`'s OpenAI branch -> `paintOpenaiCreateModel`
  (loading / listable / not-listable per Mona Lisa's design; "Let OpenAI choose (recommended)"
  first; note keyed to `because` via `openaiNoModelsNote`). Re-fetch on account change; a
  generation guard (bumped on fetch AND on leaving OpenAI) against stale resolves. The account's
  models live in a SEPARATE `OPENAI_PICK_MODELS` cache (not merged into the Claude-only
  `CREATE_MODELS`, which the Claude create + detail pickers render whole); `paintModelWhy`
  searches the union. The Claude branch repaints from `CREATE_MODELS` and restores a remembered
  non-default pick (`LAST_CLAUDE_MODEL`) across a provider round-trip. The create submit sends the
  chosen model for either provider (empty = not sent).
- **Browser check (#1720)**: `render-create-openai-model-2140.js` (stubs fetch; reds on
  origin/main); `render-picker-provider-2097.js` updated for the new not-listable note;
  registered + counts bumped.

## Verification
- Full suite green (validation hash ef554d899058). Engine 147/147, web picker tests, browser
  checks. Verified LIVE on stubbed-models boards: the picker renders in the cascade, selecting a
  model shows its why; a provider round-trip shows Claude models (no OpenAI leak) and preserves a
  non-default Claude pick.
- Browser check reds on origin/main (paintOpenaiCreateModel absent); passes on the fix.

## Decisions / rejected
- **Rejected: merge OpenAI models into CREATE_MODELS** (my first design; a reviewer caught it):
  it leaks OpenAI rows into the Claude create + every Claude detail picker. A separate cache is
  correct.
- **Rejected: client-side gray-out / static OpenAI catalogue**: OpenAI models are per-account and
  dynamic, so validation is async at the server route (the accountConnectable seam), not the
  static list.
- **Weakest premise**: the engine sanity-bounds the OpenAI id but the authoritative "this account
  can run it" check is async at the route; a direct API caller bypassing the route could write a
  well-formed-but-wrong id (the picker never offers one, and codex would refuse at launch).
