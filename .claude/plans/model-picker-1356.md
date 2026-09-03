# Plan: model-picker-1356 — add Claude Opus 4.8 and Fable 5.1 to the model picker

Card: joshualeestone/kosmos#1356 (Part 1 only)

## What "finished" looks like

- The create-screen model picker offers **Claude Opus 4.8** and **Claude Fable 5.1**
  in addition to the existing four (Fable 5, Opus 5, Sonnet 5 default, Haiku 4.5).
- Both new ids are pinned from the sources that already serve them, not guessed.
- A running agent on either model shows a clean display name on the board (not a raw id).
- Full node suite green, including the two existing guards that constrain this change.

## Scope decision (mine, per Josh's decide-it-yourself rule)

- **Part 1 only** — add the two models to the picker. Josh asked for Opus 4.8
  (2026-08-28) and Fable 5.1 (2026-09-01, "add that ... along with Opus 4.8").
- **Part 2 explicitly NOT done** — moving fleet agents onto 4.8 is the card's separate,
  UNMEASURED question ("doesn't go off in endless loops" is an unverified behavioural
  claim). I do not touch agent assignments, and the `why` copy must not assert it as fact.

## Pinned ids / names (from the sources that serve them — the card's caution against guessing)

- **Opus 4.8**: id `claude-opus-4-8`, display `Claude Opus 4.8` (engine/status.js:3365,
  test-guarded at status.test.js:424), measured context ceiling `1000000` already in
  CONTEXT_LIMITS (status.js). The board already knows it; only the picker was missing it.
- **Fable 5.1**: id `claude-fable-5-1` (the harness's own model-id list; matches the
  `claude-fable-5` -> `claude-fable-5-1` point-release pattern), display `Claude Fable 5.1`
  — NOT yet in status.js, so I add it. No measured context ceiling (I have not measured
  one) → it uses the existing labelled-assumption fallback; I will NOT invent a number.

## Changes

1. **engine/create.js** `MODELS`: add two anthropic rows (no `default`), same shape
   `{ key, provider, label, arg, why }`:
   - `{ key: 'opus48', provider: 'anthropic', label: 'Claude Opus 4.8', arg: 'claude-opus-4-8', why: ... }`
   - `{ key: 'fable51', provider: 'anthropic', label: 'Claude Fable 5.1', arg: 'claude-fable-5-1', why: ... }`
   `why` copy: factual, modest, no unmeasured loop claim. Fable 5.1 copy grounded in the
   tool's own served banner ("writes better code and reports progress on long tasks").
2. **engine/status.js** `MODEL_NAMES`: add `'claude-fable-5-1': 'Claude Fable 5.1'`.
   Required by the existing create.test.js:1947 guard AND so a running Fable 5.1 agent
   shows a name, not the raw id.
3. **engine/create.test.js**:
   - Update the #1026 guard `modelsFor('anthropic').length` from `4` to `6`.
   - Add a targeted test pinning the two new rows are offered with the right arg+label
     (a dangerous-answer check: if a row is dropped or mis-named, it fails).

## Why this is backend-only (no browser gate)

`server.js:2565` serves `create.MODELS.map(...)` at `/api/roles`; "the create screen reads
this straight into its dropdown" (create.js docblock). The picker is dynamic — adding rows
to MODELS updates it with no web/index.html edit. So no web/index.html change, no
browser-check gate chain.

## Verify

- `yarn test` full suite green. Key guards: create.test.js:1947 (arg->label round-trip,
  now covering both new rows), create.test.js:3785 (anthropic count, updated to 6).
- Read the served shape: the two rows appear in `modelsFor('anthropic')` with correct
  key/label/provider and no `default`.

## Weakest premise / documented choices

- I ADD Fable 5.1 alongside Fable 5 rather than replacing it (Josh said "add"). Two Fables
  in the picker is slightly redundant; deleting the Fable 5 row is a trivial reversible
  follow-up if he prefers 5.1 to supersede 5.
- Opus 4.8 is an older generation than Opus 5; offering it is intentional (Josh asked).
- The live-picker visual ("what renders for an agent already running 4.8") is best confirmed
  in a browser; the dynamic-from-MODELS path + the round-trip test cover the code, and I note
  a browser spot-check as an optional follow-up rather than a blocker (backend change only).
