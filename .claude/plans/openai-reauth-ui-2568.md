# Plan: #2568 OpenAI "Sign in again" affordance (wired to #2584 reauth-in-place)

Closes the second half of #2568. The overlap fix shipped earlier; the "Sign in again"
affordance was deferred because no safe OpenAI reauth existed. #2584 landed the
reauth-in-place driver, so the affordance is now buildable.

## What it does
An OpenAI ChatGPT-subscription row (Settings > AI Models) now offers "Sign in again",
via the SUBSCRIPTION flow, not the Claude browser-OAuth flow.

- Render (web/index.html accountRow): the old `isOpenai || a.apiKey ? ''` single
  suppression becomes a per-provider ternary. Claude subscription rows keep their
  `data-reauth` button; an OpenAI `a.authMode==='chatgpt'` row gets a `data-openai-reauth`
  button; api-key rows of either provider get neither (no sign-in to redo).
- Binding: `[data-openai-reauth]` -> `openAcctReauthOpenai(dir, email)`, distinct from the
  Claude `[data-reauth]` -> `openAcctReauth`.
- `openAcctReauthOpenai`: sets `ACCT_OPENAI_REAUTH_DIR`, opens the dialog in reauth chrome,
  picks OpenAI. `acctPick('openai')` routes a reauth straight to the ChatGPT sign-in step
  (skipping the picker), mirroring the Claude reauth's straight-to-sub behaviour.
- The `/api/accounts/openai/subscription/start` POST threads `reauthDir=ACCT_OPENAI_REAUTH_DIR`,
  so the #2584 driver refreshes THIS account in place (promote only on an identity match).
- `ACCT_OPENAI_REAUTH_DIR` is cleared by `openAcctAdd` like its Claude sibling, so a fresh
  "+ Add a provider" is never silently a reauth (the stale-dir hazard #1492 warns about).

## Tests
- web.reauth-1492.test.js rewritten for the per-provider logic (both buttons present on
  their subscription rows, neither on api-key, each wired to its own flow, reauthDir
  threaded).
- docs/browser-checks/render-account-badge-1921.js (headless): the chatgpt row renders
  data-openai-reauth and NOT data-reauth; Claude rows the reverse; the two never cross.
- web.openai-subscription-picker-2338.test.js slice widened for the added POST comment.

## Scope / weakest premise
The click-through end-to-end (actually completing a reauth against a real ChatGPT account)
rides the same Phase-5 real-sub gate as #2338/#2584; render + wiring + reauthDir-threading
are covered here without one. Weakest premise: that acctPick('openai') reliably lands on
the sub step for a reauth despite its async runner-look; mitigated by revealing the sub
step inside the acctOpenaiLook().then (after acctOpenaiStep), and acctOpenaiChoose focusing
the sign-in button itself.
