# Plan: provider-aware create-agent picker (#2097 + #2098)

## Goal
Make the create-agent picker in `web/index.html` provider-aware so an OpenAI
key never shows a stale Claude model, and an OpenAI-only machine does not force
the person to correct "Anthropic Claude" on every create.

## Cards
- **#2098 (correctness):** on OpenAI the model SELECT row is hidden WHOLE (not
  merely disabled -- a disabled `<select>` still displays its stale Claude
  value), and a "OpenAI picks its own model for now." note is shown in its
  place. On Anthropic the model row is shown and the note hidden.
- **#2097 (default):** the provider defaults to OpenAI only when OpenAI is the
  sole usable provider (an OpenAI account and no Claude account); otherwise it
  falls back to the Claude default. Because `resetCreateProvider` runs before
  the account list is fetched, `loadCreateExtras` re-applies the OpenAI default
  once the real list lands -- gated on a `CREATE_PROVIDER_TOUCHED` sentinel so a
  deliberate pick (manual or an import that set the provider) is never
  overridden.

## Approach
- `applyCreateProviderUI()` hides `#create-model-row` on OpenAI and shows the
  note; the note is a SIBLING of the row so hiding the row keeps the note.
- `resetCreateProvider()` computes the provider-aware default and clears the
  touched sentinel; the create-provider `change` handler sets the sentinel.
- `loadCreateExtras()` re-applies the OpenAI default after the accounts fetch,
  behind the sentinel and `EXTRAS_GEN` staleness guard.
- A browser check (`docs/browser-checks/render-picker-provider-2097.js`) drives
  the real `applyCreateProviderUI` and asserts the rendered hide + note; it reds
  on `origin/main` (no `#create-model-row`). Node tests source-pin the hide,
  default logic, and the armed sentinel.

## Decisions
- **Account row stays SHOWN even at one account.** The #2097 suggestion asked to
  hide it; an OLDER documented Josh ruling at the account markup (~index.html
  8037) says show it -- the middle rung of the provider->account->model
  narrowing, a missing rung reads as a broken diagram. Both are Josh's. Default:
  honor the documented ruling, ship, flag for a morning re-rule (reversible: a
  one-line re-add). Endorsed by Splinter.

## Not doing
- No Stripe / billing (that is a separate half of the coordinator work).
- No change to `#create-model-field` (the whole provider+account+model group);
  only the model and account ROWS are addressed.

## Validation
`tools/run-tests.sh` (full gate) + the committed browser check + the node tests.
Challenge-loop is the pre-PR gate (see the `-pre-challenge.md` proof).
