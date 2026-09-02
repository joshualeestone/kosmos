# #1903 — Create must not hand a new agent an account that cannot sign in

## The incident (root cause of Ben's block)
A freshly-created Claude agent (Fable 5 · Claude Max) 401'd on its FIRST turn:
`● Please run /login · API Error: 401 OAuth access token has expired.` It took a
turn ("Worked for 1s") before failing, so it starts, receives, and dies on the
API call — every creation step reports green.

## Root cause (in code)
`engine/create.js createAgentInner` selects the chosen account (`accounts.list()`
for Claude, `openaiaccounts.list()` for OpenAI) and sets the agent's `configDir`
to that account's dir, with **no check the credential there is live**. An account
whose stored token has expired produces an agent that cannot work, and creation
reports success. This is the **same structure-not-liveness gap #1315 fixed for
OpenAI's add flow** (`addWithKey` only checked a local `codex login` exit
status), now on the create path.

## The fix (the #1315 template applied to create)
- New async `create.accountConnectable({provider, accountDir})`: resolves the
  chosen account and live-checks its credential (Claude: `subscription.checkLive`
  scoped like `accounts.listLive` — default with no configDir, labelled by path;
  OpenAI: `openaiaccounts.checkLive`, the `/v1/models` badge check). Returns
  `{ok:true}` to proceed or `{ok:false, because}` for a positively-dead sign-in.
- **The #1315 asymmetry, deliberately:** refuse ONLY a positively-confirmed dead
  sign-in (`checkLive` state NONE). Accept connected AND unconfirmable
  (unreachable, scope-restricted) — never block a legitimate account. Accept an
  UNRESOLVABLE account too, so `createAgentInner` keeps ownership of the
  "we do not know that account" refusal (`REFUSE_ACCOUNT`).
- **The route awaits it before creating.** `POST /api/agents`'s callback is now
  async and calls `accountConnectable` after projects validation and BEFORE the
  home seed (so a refusal needs no rollback); a not-ok answer is a 400 with the
  remedy. `createAgentInner`/`createAgent` stay **sync** — its 158 test call
  sites and every caller are untouched, the same containment #1315 used.
- The refusal names the remedy (re-authenticate that account), which is the flag
  Josh asked for: "a fix so he could create an agent and not have this problem,
  or it would flag that he needs to reauthenticate."

## Tests
- `engine/create.account-connectable-1903.test.js` (8): dead Claude → refused +
  remedy; connected → accepted; unconfirmable → accepted (fail-open); unknown →
  accepted (createAgentInner owns that refusal); the DEFAULT checked with NO
  configDir (a dead default refused — proves default-scope, guards the decoy
  bug); OpenAI dead-key → refused; OpenAI 200 → accepted; OpenAI scope-restricted
  401 → accepted. Seams: `subscription.setRunner` / `openaiaccounts.setFetcher`.
- `server.create-live-1903.test.js` (2): POST /api/agents on a dead account →
  400 + remedy + NO launch file written; on a connected account → not blocked by
  the gate. End-to-end route wiring.
- No regression: `server.projects.test.js` (122) + `server.agent-import-1652`
  (6) still pass — the gate is fail-open on the UNKNOWN their fake bins produce.

## Weakest premise
Same as #1315/#1885: whether `claude auth status` reports a given expired token
as `loggedIn:false`. Ben's error was "OAuth access token has expired.
Re-authenticate to continue" — the refresh itself failed, which `auth status`
reports as not-logged-in (probed: an empty dir → `loggedIn:false`). If a future
token expired in a way `auth status` still calls logged-in, this gate would
fail-open (accept) rather than falsely refuse — the safe direction.

## Not in scope
- The #1885 WRITE half (targeted re-auth into an agent's dir) stays held.
- This fixes the CREATE path. Existing already-created agents with a dead
  credential are surfaced by #1884 (board) and #1885 (per-agent liveness), and a
  re-auth flow for them is the WRITE half.

## After merge
Cut 0.6.22, which then carries #1880 + #1884 + #1315 + #1885-backend + #1903 —
and #1903 is the one that lets Ben create a working agent. Verify served both
arms; budget for stale browser-gate checks.
