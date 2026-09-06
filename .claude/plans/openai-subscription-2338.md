# openai-subscription-2338: ChatGPT-subscription sign-in backend (#2338)

## Problem

Kosmos can connect an OpenAI account today only by API key (`addWithKey`, a fast
synchronous `codex login --with-api-key`). #2338 adds the SUBSCRIPTION path: sign in with
a ChatGPT Pro subscription, which is `codex login` (browser localhost-callback, or
`--device-auth` printing a URL + user code). That is a LONG interactive flow the user
completes outside Kosmos, so it cannot be a synchronous request.

## What this branch builds (buildable without Josh's subscription)

The backend seam, so Kitty's picker has routes to build against and Renet's screens have a
state machine to render. Per the card, everything here is buildable and mergeable WITHOUT a
live ChatGPT subscription; the ONE part that needs it (the exact stdout lines codex prints)
is isolated and verified at the release gate.

- **`engine/openaiaccounts.js`** (driver):
  - `startChatgptLogin({label, mode, codexBin})` - spawns `codex login [--device-auth]` ASYNC
    into a FRESH isolated `CODEX_HOME` (`resolveFreshChatgptDir`, never the user's ~/.codex),
    keeps a session in a Map, returns `{ok, sessionId, mode, authUrl?, userCode?}`. Refuses a
    non-runnable codexBin.
  - `chatgptLoginStatus(sessionId)` - polls: `{ok, state, authUrl?, userCode?, account?, error?}`;
    states `starting -> awaiting-browser|awaiting-code -> connected|error|cancelled`.
  - `cancelChatgptLogin(sessionId)` - kills the child and anti-litters ONLY a dir it created
    that no account landed in.
  - `finishChatgptLogin({dir,label})` - the CONNECTED GATE: accepts only `authMode:'chatgpt'`
    (an API key that completed is refused as the separate connection type), reads the row back.
  - `parseChatgptLoginOutput(text)` - PROVISIONAL: recognises an https URL and a short device
    code by SHAPE, not a fixed line format. The one release-gated piece.
- **`server.js`** (3 routes): POST `/api/accounts/openai/subscription/start`, GET `.../status`,
  POST `.../cancel`. Validation, `needsRunner` when codex is absent, the response shapes the
  picker keys on.

## Decisions (mine, reversible, documented)

- **Own isolated CODEX_HOME per session**, never ~/.codex - a mid-login failure or cancel can
  never damage the user's real codex login. Anti-litter removes only a dir we made with no
  account in it.
- **Session lifetime = server process.** A mid-login server restart drops the session (MVP
  tradeoff vs connect.js's tmux; acceptable for a ~1-minute flow). Documented in-code.
- **The subscription discriminator is `authMode:'chatgpt'` + `keyTail:null`**, so a connect row
  tells a subscription account from a keyed one without remembering which flow made it. This is
  the vocabulary the connect-UI contract (posted on the card) keys on.
- **The parser recognises SHAPES, not fixed lines**, so the release-gate change is confined to
  one function and cannot silently break the routes.

## Testing

- `engine/openaiaccounts.chatgpt-driver-2338.test.js` - the full driver lifecycle against a MOCK
  codex (writes a chatgpt auth.json / fails / sleeps-for-cancel): start -> connected, device mode,
  failure cleanup, cancel cleanup, non-runnable refusal, unknown-session refusal.
- `server.openai-subscription-2338.test.js` - the 3 routes with the driver + runner resolver
  MOCKED (never spawns a real codex): validation, needsRunner, the response shapes.
- `engine/openaiaccounts.chatgpt-2338.test.js` - the connected-gate / identity / discriminator.

## Out of scope

- The exact codex stdout PARSER against REAL output + the end-to-end release gate: ride Josh's
  ChatGPT Pro (release gate).
- Kitty's picker UI + Renet's screens: contract posted on #2338; they build against these routes.
- A live CONNECTED badge (a re-verifiable liveness check like Claude's): a separate UX call.
