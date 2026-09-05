# #2140 error matrix: distinct OpenAI /v1/models failure states

## The problem

`engine/openaiaccounts.js accountModels` folded every non-200 from `/v1/models`
into one catch-all `{ok:false, because:"OpenAI did not return this account's models
(it answered <status>)"}`. The client's `openaiNoModelsNote` then rendered that as
"we could not reach OpenAI" — which is wrong for a **401** (the key was *rejected*;
we reached OpenAI fine) and a **403** (permission denied). Astra's OpenAI spec calls
for distinct states, and specifically "403 = show the denied operation, do NOT say
no models."

## The slice (this PR)

- **Engine `accountModels`**: map `r.status` to distinct, honest `because`:
  - 401 → "API key was rejected by OpenAI (401)" (reconnect)
  - 403 → "not allowed to list models (403)" (names the denied operation)
  - 429 → billing/quota vs rate-limit, separated by the structured error code
    (`insufficient_quota`/billing vs `rate_limit_exceeded`; "limit" deliberately
    NOT a billing indicator, since `rate_limit_exceeded` contains it)
  - 5xx → "OpenAI is having trouble (…)" (retryable)
  - other non-200 → the existing generic message (unchanged)
- **Client `openaiNoModelsNote`**: a matching arm per state, ordered BEFORE the
  generic "could not reach" arm, each naming what happened + the remedy, none
  saying "no models".

## Tests
- `engine/openaiaccounts.test.js`: a test per status (401/403/429-billing/429-rate/5xx)
  + a 200 CONTROL proving the matrix did not swallow the good path + a no-key-leak assert.
- `web.openai-model-errors-2140.test.js`: the shipped `openaiNoModelsNote` per case,
  + two controls (ChatGPT not-an-api-key unchanged; genuine unreachable still reads so).

## Not in scope (noted)
- The not-listable OPTION still shows "OpenAI picks its own model for now" for a
  broken account; the honest note carries the truth. Refining the option per state
  is the next slice.
- "Compatibility not verified" labeling for unknown model IDs, per-agent
  connectionId+modelId persistence hardening — later slices of the fuller #2140.

## Weakest premise
The 429 billing-vs-rate split keys on OpenAI's structured error `code`/`type`. If
OpenAI returns a 429 with no error code, it falls to the rate-limit message — the
safe default (retryable), not a false billing claim. What would change it: a
measured 429 shape that carries billing intent without a quota/billing/insufficient/
spend code.
