# Plan: #2420 listing/badge slice — make an api-key Claude account first-class

**Branch:** `apikey-listing-2420`
**Card:** kosmos #2420 (stays OPEN for the follow-up slices). Slice 1 (engine core + POST
`/api/accounts/claude/apikey` route) already merged as PR #2423.

## Problem

An api-key Claude account writes NO `oauthAccount`. It is configured as a mode-0600 key file
at `<dir>/.kosmos-claude-apikey` (`engine/claudeaccounts.js` `KEY_BASENAME`) plus a
settings.json `apiKeyHelper` pointer. `engine/accounts.js` enumerates Claude accounts by
`identityOf(dir)`, which reads `oauthAccount` only, so an api-key account is invisible in
`list()` / `listLive()` and therefore in `GET /api/accounts`. This slice makes it first-class:
listed, with a live badge.

## Design

### 1. `list()` surfaces api-key accounts (engine/accounts.js)

- A dir carrying the `claudeaccounts` key-file marker (and no `oauthAccount`) is an api-key
  account, exactly as an `oauthAccount` marks a subscription account. New helper
  `apiKeyStored(dir)` lazily requires `claudeaccounts` (matching `nextWorkDir`'s load-order
  convention: claudeaccounts -> subscription -> lazy accounts) and fails CLOSED.
- Every Claude row carries `apiKey: true|false` — present-and-typed, never absent-vs-false —
  so the field has one meaning across the list and `listLiveNow` can branch on it.
- Identity is label-derived (`email`/`organization` null) for api-key accounts.
- The `!who` guard keeps the default account and any dual-marker dir (oauth + key) on the
  subscription path; `apiKeyStored` is only reached where `identityOf` is null, so the 5s
  status tick pays no extra stat for a real oauth account.

### 2. `listLiveNow()` badges api-key rows via `claudeaccounts.checkLive` (engine/accounts.js)

- An api-key account has no OAuth subscription to query; its liveness is whether the stored
  key still authenticates. Route api-key rows to `claudeaccounts.checkLive(dir)` instead of
  `subscription.checkLive`, shape-matched with `{...c, plan: null}` (an api-key account has no
  subscription plan) so the server-side observed-verdict badge overlay reads one vocabulary.

### 3. Connect-start guard against OAuth-over-key (server.js `/api/connect/start`)

- Making api-key dirs visible to `list()` makes the per-row "Sign in again" OAuth reauth path
  (`/api/connect/start` accountDir mode) reachable onto them — before, an api-key dir was
  `!known` and refused. OAuth reauth there would write an `oauthAccount` beside the key +
  apiKeyHelper; Claude Code prefers apiKeyHelper, so billing would silently stay on the key
  while the row reclassified as a subscription and the badge showed the OAuth email connected.
- Guard: refuse an OAuth sign-in into any dir holding a stored key. Mirror of the create
  route's taken-label guard (which blocks a key over an existing oauth); this blocks an oauth
  over an existing key. **Keyed on the key FILE, not `list()`'s `apiKey` flag**, so it also
  catches a dual-marker dir that `list()` classifies `apiKey:false` (oauth identity wins).
  Both billing-contamination directions are now closed.

### 4. Reachability guard (engine.reachable.test.js)

- Remove the now-false "genuinely dormant" `checkLive` excuse from the #265 orphan guard:
  `listLiveNow` is a real caller now.

## Rejected alternatives

- **Change `identityOf`'s contract** to recognize api-key accounts: rejected — `identityOf`
  guards `forgetAccount`'s `.claude-workers` protection; a separate `apiKeyStored` fallback is
  cleaner and localized.
- **`apiKey` only on api-key rows**: rejected — a boolean on every row (present-and-false for
  subscription rows) keeps one meaning and lets `listLiveNow` branch cleanly.
- **Guard keyed on `list()`'s `apiKey` flag**: rejected — the flag is false for a dual-marker
  dir, so a flag-keyed guard would let OAuth-over-key through; the key file is the ground truth.

## Weakest premise

A dir carrying BOTH markers (oauth + key) is surfaced as its subscription account (`apiKey:false`).
This is fine because the connect route's guards prevent that state at creation from both
directions (create-route taken-label guard blocks key-over-oauth; the connect-start guard added
here blocks oauth-over-key), and the oauth identity is the more informative one. The dual-marker
connect-start refusal is tested and perturbation-verified.

## Deferred to later slices (tracked on #2420)

- **Slice 2 (removal route, my next task):** `forgetAccount` / `removeAccount` /
  `DELETE /api/accounts/claude` refuse api-key accounts (they gate on `!identityOf`) and do not
  erase the key file (#1414 leak-prevention). Separate slice: it changes sensitive forget/remove
  semantics. Harm is not user-reachable yet (no UI creates api-key accounts). **Ordering: slice 2
  must land before the UI slice (3).**
- **Slice 3 (Angel):** choice-first UI + key field + an api-key row indicator (the `apiKey` flag
  is surfaced for this). **Copy (Mona).**
- **Slice 4 (operator):** a real green-with-a-real-key needs an operator to paste a real
  `ANTHROPIC_API_KEY` (none on this box).

## Test plan

- `engine/accounts.test.js`: list surfaces api-key accounts (label-derived identity, apiKey:true);
  the stored-key marker (not the name) is what makes an account; oauth rows apiKey:false; listLive
  routes api-key badges through `claudeaccounts.checkLive` (discriminated by a 401 while
  subscription says CONNECTED); a valid key reads CONNECTED. Fixtures cleaned up in `finally`.
- `server.connect.test.js`: OAuth reauth into an api-key account refused; a dual-marker dir
  (`apiKey:false`) still refused (file-vs-flag). Both perturbation-verified.
- `engine.reachable.test.js`: the #265 guard passes without the excuse.
- Full suite green.
