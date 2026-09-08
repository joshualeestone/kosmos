# Item 8: pre-pick the provider's default model on an imported agent

Branch: import-default-model-8. Owner: Angel. Mona ruled 2026-09-08: PRE-PICK the provider's
default model on an imported OpenAI agent (not "Let OpenAI choose"), symmetric with the Claude
side which already lands on its base model. Grounded in Josh's "get that agent on a middle-to-low
model of that provider to start."

## Change (OpenAI only; Claude already lands on m.default via loadCreateExtras)
- `let IMPORT_OPENAI_MODEL = null;` module pref.
- finishImport: when OpenAI is the honoured provider, stash `data.model` (the import response's
  `defaultModelKeyFor(provider)` key from Pete's #2462) BEFORE the provider-change dispatch.
- paintOpenaiCreateModel LISTABLE branch: after populating the account's models, if the stashed
  key is one of THIS account's models, `sel.value = key` (pre-pick); else leave "Let OpenAI
  choose". One-shot: clear the pref after the paint (both branches).

## Why safe: DEGRADES GRACEFULLY
Setting sel.value to a key not in the list is a no-op (stays on "Let OpenAI choose" = today's
behavior). So no hard dependency on key alignment; when the key IS offered (the designed case) it
pre-picks.

## Verify
- Browser-check: an OpenAI import (stub /api/accounts/openai/models to return a list incl. the
  default key) pre-selects it; a stub WITHOUT the key falls back to "" (Let OpenAI choose). Plus a
  Claude import still lands on its default (control). Wire per #1720 (hermetic runner + reason-grep
  + README) OR extend an existing import/openai check.
- Full run-tests.sh; challenge-loop; PR (merge on green).

## 2026-09-08 HALT (Angel): the OpenAI premise is FALSE, this branch is a production no-op

Challenge-loop iteration 2 (blind, sonnet) surfaced, and I verified against the engine source, that
the OpenAI half of this branch CANNOT fire in production. The plan's premise (stash the import
response's `defaultModelKeyFor(provider)` key) is contradicted by the engine, deliberately:

- `engine/create.js` MODELS has ZERO `provider: 'openai'` entries, so `modelsFor('openai')` is empty
  and `defaultModelKeyFor('openai')` returns `null`.
- `server.js` (both import handlers, ~7112 and ~7239) returns `model: create.defaultModelKeyFor(parsed.provider)`
  with the comment: "'sonnet' for a Claude import; null for OpenAI (codex picks its own)."
- `modelsFor`'s own doc comment calls the null the "intended 'let codex choose' state."

So for every real OpenAI import `data.model === null`, `IMPORT_OPENAI_MODEL` is set to null, and the
pre-pick guard never fires. The change is invisible in production; the tests only pass by
hand-injecting `IMPORT_OPENAI_MODEL = 'gpt-mid'`, which masks the gap. Claude imports already land on
their default (`loadCreateExtras`), untouched by this branch. Net observable behavior change: none.

There is no concrete middle-low OpenAI key to pre-pick: the engine has no OpenAI models by design
(codex picks its own), and the only per-account "default" (`chatModelsFromList`) is the MOST-capable
model, the opposite of Josh's "middle-to-low" intent, and using it would override the deliberate
"codex picks its own" design + Josh's 2026-09-04 "OpenAI picks its own model for now" refinement.

### DECISION (Angel): do NOT merge this branch. Route the design conflict to Mona.
Recommendation: OpenAI imports correctly land on "Let OpenAI choose" (codex picks its own) TODAY, so
Item 8 is satisfied for Claude (already works) and not-applicable to OpenAI as the stack stands. If
Josh still wants an OpenAI import on a concrete middle-low GPT, that is an ENGINE change for Pete
FIRST (define OpenAI models + a middle-low default in `engine/create.js`); this web pre-pick is then
the ready client half. Merging the web half now ships either dead code (if OpenAI stays
codex-picks-its-own) or a mechanism waiting indefinitely on an engine half with no committed plan.
Weakest premise in THIS decision: that Pete has no plan to add OpenAI models; if he does, the web
half here is correct and forward-compatible and could merge as such. Parked pending Mona's ruling.

The iteration-1 leak fixes (authoritative stash, resetCreateProvider clear, the harness declarations)
are correct and stay on the branch, but they harden a mechanism that does not yet fire.
