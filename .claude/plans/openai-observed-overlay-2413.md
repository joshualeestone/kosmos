# Plan: #2413 Phase 1 — extend the #1921 observed-liveness overlay to OpenAI rows

## Problem

A codex ChatGPT-subscription sign-in (`auth_mode=chatgpt`) RUNS fine, but the board's connection
badge can never go green. `openaiaccounts.checkLive` returns UNKNOWN for a chatgpt-mode auth.json
because codex's id_token is not a bearer key testable against `/v1/models` (openaiaccounts.js
~1117/1126). So a genuinely working subscription sits grey "not checked live" with no way to
distinguish it from a dead one. Real prod users hit this (#2790/#2799: "Dave" had 5 codex agents
sit Idle forever on a sign-in that showed grey and never recovered).

There is no free, supported OpenAI endpoint to positively confirm a subscription session, and
#1921/#1959 forbid a costly probe on the badge path. So the fix is not a new probe — it is to
extend the existing #1921 OBSERVED-liveness overlay (green from real successful traffic we already
watch) to the OpenAI rows.

## Approach (Phase 1, positive-only)

1. **`engine/observed.js` — provider-qualify the observation store.** Key observations by
   `(provider, agent)` instead of `agent` alone, so an OpenAI `ok` can only ever be read by the
   OpenAI overlay and a Claude `ok` only by the Claude overlay. This is essential: a codex agent on
   the default home records `configDir=null`, which `accountForAgent` maps to the DEFAULT CLAUDE
   account — so without the provider in the key an OpenAI `ok` would green a Claude account. The
   join is injective because `provider` is a closed, space-free enum.

2. **`engine/codexsession.js` — expose `contextUsedAt`.** The epoch-ms timestamp of the
   `token_count` event that set `contextUsed`. A `token_count` carrying a real `last_token_usage`
   is a turn that ran to completion; a dead-credential 401 reconnect loop never emits one. This is
   the freshness anchor for a witnessed `ok`.

3. **`engine/status.js` — record an OpenAI `ok` from a witnessed rollout completion.** A codex pane
   was previously excluded from the observed store entirely. Now it records an OpenAI `ok` — but
   ONLY from a fresh rollout completion (`codexLastCompletionAt`), NEVER from pane WORKING. This is
   the load-bearing #2790 fixture finding: a dead-credential 401 reconnect loop scrapes as WORKING
   too, and a scraper cannot tell it from a transient reconnect 401, so recording WORKING as `ok`
   would false-green a dead sign-in (the #874 harm). The `ok` is stamped at the completion time and
   gated on freshness, so it greys again on its own once the last real turn ages out. POSITIVE-ONLY:
   no red/rejected for codex in Phase 1, so it can never produce a false "not connected".

4. **`server.js` `/api/accounts` — overlay the observed verdict onto the OpenAI rows.** Joined via
   `accountForAgent(name, openaiRows)` (a codex agent's `CODEX_HOME` configDir → its OpenAI account
   dir; `null` → the default account). This is ADDITIVE / positive-only, NOT a literal mirror of the
   Claude overlay: only a FRESH observed `ok` upgrades a row to green. Every other case leaves the
   OpenAI row exactly as it renders today. This deviation is deliberate and load-bearing — a literal
   mirror maps checkLive `connected` → `signed_in_unverified`, which is correct for Claude (a Claude
   `connected` is only "a credential exists", #874) but would REGRESS a live OpenAI API-key account,
   whose `connected` is a REAL `/v1/models` liveness proof that renders green today. It would also
   bypass the tailored #2568 chatgpt "not checked live" pill. The Claude loop is also filtered to
   `provider === 'anthropic'` so an OpenAI observation can never reach it.

## What is deliberately NOT in scope

- **Phase 2** (separate, gated): PigeonPete's observed on-pane Codex auth-failure → RED, paired with
  ICK's offline tier read (`chatgpt_plan_type` / `chatgpt_subscription_active_until` from the token's
  auth claim, no network) to catch the lapsed-plan false-green. No red/rejected for codex in Phase 1.
- **The render UX** distinguishing `unknown` (chatgpt, cannot check) from `none` (checked + signed
  out) is Angel's render lane. This plan produces the badge on the OpenAI row; the web render already
  reads `connection.badge` provider-agnostically.
- **A costly probe** of any kind on the badge path (#1921/#1959 forbid it).

## Tests

- `engine/observed.test.js`: provider-qualified store; injective join across a space-containing name.
- `engine/codexsession.test.js`: `contextUsedAt` extraction; null when no completed turn.
- `engine/status.observed-1921.test.js`: a codex WORKING pane with no completion records neither an
  ANTHROPIC nor an OpenAI observation.
- `engine/status.codex-observed-2413.test.js`: `codexLastCompletionAt` resolution; a fresh completion
  records an OpenAI `ok` (never ANTHROPIC); a stale completion records nothing (self-heals).
- `server.openai-badge-2413.test.js`: fresh observed `ok` greens the subscription row; no regression
  on a live API-key account; cross-provider isolation; grey preserved on a stale observation.
- `server.badge-observed-1921.test.js`: updated for the provider-qualified `saw` signature (Claude
  behavior unchanged).

## Risks / weakest premises

- **Weakest premise:** that a witnessed rollout completion (a `token_count` with real
  `last_token_usage`) cannot be produced by a session whose auth is failing. Resolved from in-tree
  evidence on #2790 (a 401 loop never completes a turn). What would change the call: a real Codex
  rollout showing a `token_count` on a turn that did not authenticate — none known.
- The self-healing green persists up to ~5 minutes after the last real turn (the freshness window),
  which is honest ("recently observed working") and never a permanent green over a dead credential.
