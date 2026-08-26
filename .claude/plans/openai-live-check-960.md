# kosmos#960 -- the OpenAI row's Connected badge has no live check behind it

## Source

Filed by Josh, 2026-08-26, out of the 0.5.57 walk right after kosmos#959 merged. Direct
quote from the issue: "This is exactly the #881 defect surviving for the other provider:
a revoked or expired OpenAI key would keep its Connected badge indefinitely. The contrast
makes it worse than before in one narrow way: the Claude rows' badges now MEAN something,
so a user reasonably reads the OpenAI badge as equally verified, and it is not."

The issue's own suggested shape: "The #959 machinery generalizes: `listLive()` already
runs per-row checks in parallel with the UNKNOWN never-sink fallback; the OpenAI row needs
its own `checkLive` equivalent (a cheap models-list call validates a key) feeding the same
connection object, so one badge vocabulary keeps one meaning across providers."

## Verified before writing any code

- `engine/openaiaccounts.js`'s `identityOf()` already distinguishes two auth modes, read
  directly from codex's own `auth.json`: `apikey` (a raw `OPENAI_API_KEY`) and `chatgpt` (an
  OAuth `id_token`, no raw key available to us).
- `codex login status` is LOCAL ONLY -- confirmed by pointing `CODEX_HOME` at a directory
  with a fabricated, never-valid key and getting `Logged in using an API key - ...` back
  anyway (exit 0). This is the exact false-positive shape the issue describes; it cannot be
  used as the live check.
- The real fix is a direct call to OpenAI's own API. Verified live against this machine's
  one real account (`~/.codex`, apikey mode, key ending `EW8A`, matching the issue's own
  reproduction exactly): `GET https://api.openai.com/v1/models` with
  `Authorization: Bearer <key>` returns `200` with a real model list for a working key, and
  `401` with `{"error": {"code": "invalid_api_key", ...}}` for a fabricated one. This is the
  standard, well-known OpenAI verification call and needs no account-specific scope.
- This machine has no `chatgpt`-mode account to test against, and codex's `chatgpt` auth
  shape hands us an `id_token` (a JWT identity claim), not a bearer credential usable
  against the OpenAI API the way the `apikey` mode's raw key is.

## Fix

- `engine/openaiaccounts.js`: new `checkLive(dir)`, mirroring `subscription.checkLive()`'s
  exact return shape (`{state, plan: null, checkedLive: true, because}`, reusing
  `subscription.STATE`'s three values rather than a second enum) so the frontend can treat
  Claude and OpenAI rows identically:
  - `apikey` mode: a real `GET /v1/models` call, injectable via a `setFetcher` seam (matching
    `tokendoor.js`'s established pattern for this exact kind of check -- verify a token
    without ever storing or logging it). `200` -> CONNECTED. `401`/`403` -> NONE. Anything
    else (network error, timeout, unexpected status) -> UNKNOWN, never NONE -- the same
    asymmetry rule `subscription.checkLive()` already enforces (a false "not connected" costs
    more than an honest "we could not tell").
  - `chatgpt` mode: UNKNOWN, honestly, with a `because` explaining this mode isn't yet
    live-checked. NOT NONE -- scoped out for now (no way to verify it against the OpenAI API
    the way `apikey` mode's raw key allows), explicitly documented rather than silently
    guessed at. A real gap, but an honest one, matching this codebase's own rule that
    "we could not check" must never render as a confirmed negative.
  - New `listLive()`, mirroring `accounts.listLive()`: runs `checkLive()` over every row in
    parallel, each row's own failure caught individually so one bad account can't sink the
    others (falls back to UNKNOWN, never a false NONE).
- `server.js`: `/api/accounts`'s existing `openaiAccounts.list()` call becomes
  `openaiAccounts.listLive()`, run in parallel with the existing `accounts.listLive()` call
  (both already async; no new sequential cost).
- `web/index.html`: three consuming call sites, matching #881's own precedent that a
  provider/state check like this tends to have sibling call sites that need the identical
  treatment:
  - `paintAccounts()`'s badge logic currently special-cases
    `isOpenai ? alwaysGreenConnected : threeStateFromClaudeConnection` -- the OpenAI branch
    of that ternary is exactly the pre-#959 hardcoded shape the issue is about. Removed;
    OpenAI rows now go through the SAME three-state renderer Claude rows already use, since
    `openaiAccounts.listLive()` now hands them a real `connection` field in the identical
    shape.
  - `paintConnLive()`'s Connect-tab summary count currently only checks
    `connection.state === 'connected'` for Anthropic rows (`a.provider !== 'anthropic' ||
    ...`), counting every OpenAI row on presence alone -- the exact same false-positive
    count #881 already fixed for Claude, unfixed for the other provider. Generalized to
    check every row's own `connection.state`, no per-provider branch.
  - `fillCreateAccounts()`'s create-agent dialog currently bypasses the not-signed-in
    exclusion entirely for OpenAI (`openai ? list : list.filter(...)`) -- the exact
    motivating symptom #881 existed to fix (creating an agent against a broken account with
    zero signal), left unfixed for OpenAI when #881's iteration 8 caught and fixed this call
    site for Claude. Generalized the same way.
  - `paintAccountPicker()` was checked and does not filter or badge by connection state at
    all (it only lets a person pick an account by name) -- correctly out of scope, not
    missed.

## Explicitly not changed

- `chatgpt`-mode accounts stay UNKNOWN, not live-checked. Filed as a known, disclosed gap
  in this same PR's description rather than pretending to close it -- verifying that mode
  would need a different mechanism (codex's own token refresh/introspection, if any exists)
  that hasn't been researched yet.
- `codex login status` itself is untouched; it remains a purely local presence check and is
  not this fix's mechanism.

## Deferred, surfaced by challenge-loop, not code defects

- **Whether `invalid_api_key` is the only OpenAI error code that should confirm a dead key.**
  A fresh review raised the possibility that other conditions (an expired key, an account
  suspension) might also permanently kill a credential while answering 401/403 with a
  different or absent error code -- which this fix would currently read as UNKNOWN rather
  than NONE. Could not be verified against the live API from this machine (no suspended/
  deactivated account to test against), so nothing was guessed at. Explicitly the SAFE
  direction per this module's own asymmetry rule: the cost, if real, is a truly-dead key
  staying "we could not check" instead of a clear "not connected" -- a UX gap, not a false
  Connected badge. Worth a follow-up issue with a real test case if it turns out to matter in
  practice, not a blocker here.
- **`askModels()`'s real production fetcher path (the actual `fetch`/`AbortController`/8s
  timeout branch, not the `setFetcher()` test seam) has no direct test.** Every test in this
  branch installs a fake fetcher. Confirmed this is not a new gap: `engine/tokendoor.js`, the
  established sibling module this pattern was copied from, has the identical shape (its own
  real fetcher branch is also never directly exercised by `engine/tokendoors.test.js`). Left
  consistent with that existing convention rather than fixed in isolation.

## Test plan

- `engine/openaiaccounts.test.js` (new or extended, matching `engine/subscription.test.js`'s
  established style): `checkLive()` for a real-shaped 200/401/network-error response via the
  `setFetcher` seam, for both `apikey` and `chatgpt` modes, and `listLive()`'s per-row
  isolation (one row's throw doesn't sink the others).
- `server.js` route test (matching `server.connect.test.js`'s existing `/api/accounts`
  coverage): confirms the response now includes a real `connection` field for OpenAI rows.
- `web/index.html` source-pattern test (matching `web.accounts-badge.test.js`'s established
  style): confirms the OpenAI branch of the badge ternary is gone and OpenAI rows render the
  same three-state badge as Claude rows.
- Verified live against this machine's real `~/.codex` account throughout, not just
  injected-runner unit tests -- same discipline as #881.

Full suite: `bash tools/run-tests.sh`, 0 failures required before PR.

## Challenge-loop

Standard `/challenge-loop` to convergence before `/create-pr`, per house process.
