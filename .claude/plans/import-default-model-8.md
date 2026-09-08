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
