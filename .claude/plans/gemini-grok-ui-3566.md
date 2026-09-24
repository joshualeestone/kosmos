# Gemini + Grok selectable in the UI (#3566)

Assigned by Splinter 2026-09-24 07:34 CDT. Target cut 0.6.92.

## Problem (measured on origin/main c4bc1acd)
The engine already creates, switches and stores keys for Gemini (`google`) and Grok (`xai`)
(#3484, #3490, #3509), but every UI door still says "coming soon":
- `#acct-provider-pick` (Settings, AI Models, Add a provider): google/xai `disabled`.
- `#create-provider` and `#d-provider`: google/xai `disabled`.
- The page reasons in two providers only (`provider === 'openai'` else Claude) in several places,
  so a Gemini/Grok account row, once it exists, is counted as a Claude account.

## Scope
1. **Add a provider**: google/xai become live options; one shared API-key step
   (`#acct-apikey-step`) POSTs `/api/accounts/{gemini|grok}/apikey` `{key, label, name}`.
   The server gains a label fallback (`nextWorkDir()`) so the name stays optional, like OpenAI's.
2. **Account rows**: key-tail naming, provider qualifier and Disconnect / Delete work for
   google/xai rows (DELETE `/api/accounts/{gemini|grok}`).
3. **Create agent**: google/xai enabled when a connected account exists, else disabled with a
   "connect it in AI Models" suffix. Account menu filtered per provider. No model is sent (the
   CLI picks its own model), the model row is hidden with a one-line note.
4. **Switch provider**: same enablement; the sign-in picker generalises from OpenAI-only to any
   keyed provider (openai/google/xai), strings parametrised by provider name.
5. One normaliser `acctProvider(x)` replaces the two-way `=== 'openai'` / `!== 'openai'` reads
   that decide "is this a Claude account".

## Out of scope (stays as is)
- First-run wizard rows for Gemini/Grok (they stay "Coming soon" there; follow-on card).
- Subscription sign-in for Gemini/Grok (#3296 / #3391).
- Model pickers for Gemini/Grok (the CLI's default model is used).

## Verification
- `tools/run-tests.sh` full suite.
- Served UI, headless pw-runtime: screenshots of AI Models (Gemini + Grok rows connected) and
  Create agent (Gemini/Grok selectable).
- One real Gemini agent and one real Grok agent created through the UI that answer a message.
