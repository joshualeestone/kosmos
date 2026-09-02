# #1315 — Validate an OpenAI key live at ADD time, not only later on the badge

## The symptom (why a user says "it won't connect")
A person pastes a dead or typo'd OpenAI key on the Add-a-provider dialog, presses Add,
and the page ACCEPTS it. Only later does the account badge read not-connected. To the
person that reads as "I connected my key and it won't connect."

## Root cause (proven live, reproduced 2026-09-02)
`engine/openaiaccounts.js addWithKey()` validates the key only by the exit status of
`codex login --with-api-key`. That is a LOCAL-ONLY check (the file's own comment,
lines 375-378: a fabricated never-valid key still reads "Logged in using an API key").
So `run.status === 0` for any well-shaped string, and the POST route
(`server.js` `/api/accounts/openai`) returns `{account}` with no live check.

The module ALREADY has a real live check — `checkLive(dir)` → `askModels()` →
`GET /v1/models` — with the correct 401 asymmetry (only OpenAI's own
`invalid_api_key` code positively rejects; a scope-restricted key that 401s on
model-listing is UNKNOWN, not NONE). But it only runs LATER, via the badge/listLive.

## What "finished" looks like
- The Add-a-provider flow rejects a positively-invalid key AT ENTRY with a plain
  sentence, and leaves no half-made account behind.
- A key OpenAI accepts (200) is added as today.
- A key we cannot confirm bad (network unreachable, or a scope-restricted 401 that
  is not `invalid_api_key`) is STILL ACCEPTED — the honest gray zone, same asymmetry
  the badge already uses. We never block a legitimately-scoped key.
- Engine tests cover all four arms; full suite green; the openai browser gate
  (`render-accounts-openai.js`) stays green.

## The fix
1. `engine/openaiaccounts.js`: new async `addWithKeyLive({ key, label, codexBin })`.
   - `const added = addWithKey(args)` — the existing local add (unchanged, sync).
   - if `!added.ok` → return it (shape / runner / local failures pass through).
   - `const live = await checkLive(added.account.dir)`.
   - if `live.state === subscription.STATE.NONE` → the key was positively rejected
     (post-add, the file exists, so checkLive NONE can only be `invalid_api_key`).
     Remove the just-made account dir (anti-litter, same intent as addWithKey's own
     failure path) and return `{ ok: false, because: 'OpenAI did not accept this key' }`.
   - else (CONNECTED, or UNKNOWN) → return `added`.
   - export it.
2. `server.js` `/api/accounts/openai` POST: `openaiAccounts.addWithKey(...)` →
   `await openaiAccounts.addWithKeyLive(...)`; make the readBody `.then` callback async.
   Response shape unchanged (`{account}` on ok; 400 `{error: because}` on not-ok).

## Why keep addWithKey sync (rejected: making it async)
`addWithKey` has 15 test call sites using a FAKE_CODEX and NO fetcher stub. Making it
async would break every one and force each shape-validation test to think about the
network. A thin async wrapper contains the blast radius to one production caller
(`server.js`) + new tests, keeps addWithKey's tests intact, and keeps the wrapper
independently unit-testable via `setFetcher`.

## Browser-gate compatibility (checked before building)
`tools/browser-checks.sh:826-837` boots a stand-in `/v1/models` that accepts EXACTLY
the walk key `sk-proj-walkwalkwalkwalkwalkWALK` (→200) and 401s anything else with
`invalid_api_key`, and points `AGENT_WORKFORCE_OPENAI_MODELS_URL` at it.
`render-accounts-openai.js:81` adds the walk key, so my add-time check → 200 → accept.
`render-openai-key-step.js` only asserts layout, never submits a key. Both stay green.

## Not in scope (documented, stays open / needs-operator)
- Criterion 3 (a real agent switched to OpenAI takes a turn on it, watched live) is
  operator-owned per Josh 2026-09-02 09:25 — needs a live OpenAI account. Stays
  needs-operator; this PR does not close #1315.
- Weakest premise: I assume post-successful-add, `checkLive` NONE ⟺ `invalid_api_key`.
  This holds because the auth file exists after addWithKey (rules out the `absent`
  NONE branch) and the only other NONE branch is `invalid_api_key`. If codex ever
  writes an unparseable file that addWithKey still exits 0 on, checkLive returns
  UNKNOWN (not NONE), so we ACCEPT — fail-open, never a false reject. Acceptable.
