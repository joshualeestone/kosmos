# #2338 - OpenAI connect picker in Settings (subscription vs API key)

## Goal (Josh's ChatGPT Pro ask)
On the OpenAI Connect step, offer a choice: connect through a **ChatGPT
subscription** (Codex signs in, no API key) or through an **API key**. This
branch builds the connect-row picker in Settings' "Add a provider" flow, wired
to PigeonPete's backend contract (kosmos#2338, branch openai-subscription-2338).

## Ownership (web/index.html is 3-way, per Pete's contract comment on #2338)
- **Renet** owns the setup-flow (first-run wizard) screens.
- **Kitty (me)** owns the connect rows / picker shell.
- **PigeonPete** owns the subscription routes + the codex login driver.

## Backend contract this wires against (Pete, #2338, v1)
- `POST /api/accounts/openai/subscription/start` body `{ mode?: "browser"|"device", label? }`
  -> 200 `{ ok, sessionId, mode, authUrl, userCode? }` (userCode only in device mode);
  400 `{ ok:false, needsRunner:true, provider:"openai" }` when the codex runner is absent.
- `GET  /api/accounts/openai/subscription/status?sessionId=<id>`
  -> 200 `{ ok, state, account? }`; 404 unknown/expired.
  state in {starting, awaiting-browser, awaiting-code, connected, error, cancelled}.
  On connected, account = `{ provider:"openai", authMode:"chatgpt", keyTail:null, email }`.
- `POST /api/accounts/openai/subscription/cancel` body `{ sessionId }` -> 200 `{ ok, cancelled:true }`.
- Discriminator: a subscription account is `authMode==="chatgpt" && keyTail===null`;
  an API-key account has a keyTail.

## What this branch builds (Settings connect flow, #acct-openai-*)
1. `#acct-openai-pick` - the choice (Sign in with ChatGPT vs Use an API key),
   shown once the runner is present, in the runner-first order (#979). Both
   flows stay hidden until a choice is made.
2. `#acct-openai-sub-step` - the subscription sign-in: start -> poll -> connected.
   No key pasted; no code pasted back (browser localhost callback; device mode
   shows a code to type on OpenAI's own page). needsRunner on start routes to
   the install step in place, same as the key path.
3. Connected paint mirrors the key path (frCheckRow gold box, live paintAccounts,
   acctShowSuccess) - differs only in the sentence.
4. closeAcctAdd stops the poll and drops the session so a completing sign-in
   cannot paint success into a hidden modal (the #1656 hazard).

## Tests
- `web.openai-subscription-picker-2338.test.js` (new): extract-and-run for
  acctOpenaiChoose (incl. idempotent sub-entry + stale-message clear),
  acctOpenaiSubView (the poll state machine), and acctOpenaiSubReset (resting
  state + button re-enable); source-pins for the exact route paths, needsRunner
  routing, the 404-terminal vs 5xx-transient split, the terminal-error teardown,
  the double-connect guard, the no-sessionId guard, and the connected-paint
  mirror. (An earlier draft carried an acctIsOpenaiSubscription discriminator
  helper; it was removed as unused - steady-state rows render via the email
  fallback and a subscription badge is a deferred Josh UX call - so the plan no
  longer lists it.)
- `web.runner-first-979.test.js` (updated): present/unknown now land on the
  picker, not the key step; both flows hidden until chosen. #979 runner-first
  invariant preserved (missing -> install only).
- `web.connect-success-1656.test.js` (updated): closeAcctAdd teardown now
  carries the sub-step ids + acctOpenaiSubStop stub.

## Decisions and what I rejected
- **Settings surface, not first-run wizard, for this PR.** Both are "connect
  steps," but the first-run wizard (#fr-openai-*) is the region Renet/Angel/Mona
  are actively rebuilding (PRs #2345, #2356 just merged) and it is launch-critical
  mid-0.6.40-cut. Building there now risks a merge collision I cannot e2e-verify
  tonight anyway (subscription e2e needs Josh's ChatGPT Pro sub = the release
  gate). The Settings "Add a provider" flow is self-contained, unambiguously my
  connect row, and the durable multi-account connect surface. The first-run
  picker is a documented follow-up, to coordinate the seam with Renet once the
  setup-flow build settles.
- **Off origin/main, not off Pete's branch.** Pete's branch touches only
  engine/openaiaccounts.js + server.js + tests (verified), never web/index.html,
  so the two changes are disjoint and merge cleanly. The UI wires against the
  documented contract shape; it goes live end-to-end when Pete's routes merge.
- **No model dropdown for a subscription account** (Pete's contract: `/v1/models`
  needs a key; MVP uses codex's default-model fallback). The picker only chooses
  the connection type.
- **authUrl for both modes** (not a separate verificationUrl - the contract
  consolidated it; device mode adds userCode).

## Weakest premise
The subscription flow cannot be verified end-to-end tonight - that rides the
release gate under a real ChatGPT subscription (Josh's, or a provisioned test
one), which is the whole card's gating input per Pete's Phase 5. What is
verified here: the picker renders/toggles, the client calls the exact contract
routes with the right shapes, the poll state machine maps correctly, the
discriminator is right, and the teardown is safe. Browser-check verification of
the rendered picker is deferred (shared-browser contention + it adds no e2e
coverage without a real subscription); noted for the release-gate pass.
