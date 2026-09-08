# Item 8 (redone): an OpenAI import lands on the account's default model

Branch: import-openai-default-model. Owner: Angel. Card: kosmos#2453 / #2140 (the "revisit OpenAI
picks its own model" line). Supersedes the parked import-default-model-8 branch (wrong source).

## The correction (Josh, live, 2026-09-08)
My first Item 8 attempt wired the OpenAI import pre-pick to the IMPORT RESPONSE's `data.model`
(`create.defaultModelKeyFor(provider)`), which is null for OpenAI by design (the STATIC engine MODELS
has no OpenAI rows). So it was a no-op. Josh corrected me: "we DO pull in a list of OpenAI models."
Right -- the LIVE per-account list from `/api/accounts/openai/models` (via `chatModelsFromList`) marks
exactly one model `default: true` (the flagship). So the default exists; I was reading the wrong list.

Josh's live call: just make a default call using that list. Decision (mine, reversible, per Josh's
standing ruling; told Josh in-channel): land an OpenAI import on the account's OWN default model (the
one the list marks). "Mid-to-low" is not a tier the list designates and is untestable here (no real
OpenAI key on this box), so the account default is the clean, non-guessing choice; a one-line change
biases it lower if Josh names a specific model. Weakest premise: Josh's older steer was "mid-to-low
for less looping," and the list's default is the flagship; flagged the escape hatch to him.

## Change (web/index.html only + one browser-check)
- `let IMPORT_OPENAI_DEFAULT = false;` one-shot module flag.
- `finishImport`: `IMPORT_OPENAI_DEFAULT = (wanted === 'openai')` in the okProv block, BEFORE the
  provider-change dispatch (authoritative -- true only for an OpenAI import).
- `paintOpenaiCreateModel` LISTABLE branch: if the flag is set, `sel.value = out.models.find(m=>m.default).key`
  (pre-pick the account default), overriding "Let OpenAI choose"; if the list has no default, it stays
  on "Let OpenAI choose" (graceful, never worse). One-shot: cleared at the end of the async paint.
- `resetCreateProvider`: clears the flag (a fresh create is not an import), beside `LAST_CLAUDE_MODEL`.
- The `!acctDir` early-return does NOT clear the flag, so it survives an account-less first paint through
  to the account-selection paint (the parked branch's iteration-1 leak lesson: clear in reset + set
  authoritatively in finishImport, never on the early return).

## Verify
- `docs/browser-checks/render-create-openai-model-2140.js` gains an IMPORT-DEFAULT section driving the
  SHIPPED paintOpenaiCreateModel with a stubbed models list (one marked default:true): control (no flag
  stays "Let OpenAI choose"), import pre-picks the account default (gpt-4o), the one-shot is consumed,
  and the fallback (no default in the list) stays "Let OpenAI choose". Passes, exit 0. Modifying this
  existing check satisfies the #1720 gate with no reason-grep/README bumps.
- Full run-tests.sh; challenge-loop; PR (merge on green). No em dashes.
- Mona is converting #d-provider / #create-provider to a logo picker (#1040); this change is create-MODEL
  side (paintOpenaiCreateModel) with only tiny resetCreateProvider adjacency, so heads-up + git merge-tree
  before either merges.
