# #3391 subscription half, part 1 (engine + routes + supervisor): a Grok account signed in with a subscription

Josh ruled 2026-09-23 that the connect for Grok should be a subscription sign-in, not only an API key.
#3566 (merged) shipped the API-key path in the UI. Grok is signed in to Josh's subscription on this
box (Splinter, 2026-09-24 07:12). This PR is the ENGINE half. The AI Models button is part 2, a
separate PR on top of these routes, so each challenge loop stays reviewable.

## Measured (2026-09-24, grok 1.0.41; never against the live ~/.grok)
- `GROK_HOME=<dir> grok login --device-auth --leader-socket <dir>/<sock>` prints
  `https://accounts.x.ai/oauth2/device?user_code=ABCD-EFGH`, the code again on its own line, an ANSI-dim
  warning, then `Waiting for authorization...`. It honours GROK_HOME (it wrote docs/ and logs/ into the
  dir). The live ~/.grok/auth.json mtime was unchanged.
- Without `--leader-socket` grok uses `~/.grok/leader.sock`, so a sign-in would share the live leader.
- A signed-in auth.json (key NAMES only, read from the live file; values never printed) is one object
  keyed `https://auth.x.ai::<uuid>` holding key, auth_mode, email, refresh_token, expires_at,
  oidc_issuer, ...; mode 0600.
- grok has no `login status` subcommand.
- `XAI_API_KEY=` (EMPTY) is still "You are using XAI_API_KEY". An empty value counts as set, so an
  account must have the variable REMOVED, not blanked.

## Changes
1. `engine/grokaccounts.js`
   - `readAuth(dir)`: absent / unreadable / ok with the single `https://auth.x.ai::` entry.
   - `identityOf`: the key file wins (unchanged apikey row). Otherwise an auth.x.ai entry is
     `{ authMode: 'subscription', email }`. Rows carry `email`.
   - `checkLive` for a subscription: OFFLINE only. An entry with a refresh_token is CONNECTED
     ("signed in with your Grok subscription"). No refresh token and a past expires_at is NONE. A
     shape we do not recognise is UNKNOWN. The observed overlay (#3548) then shows
     `signed_in_unverified` until a real grok session succeeds, and `working` after. Nothing reads
     green on a file alone.
   - `nextWorkDir`: a slot is free only with neither a key file nor an auth.json.
   - `startGrokLogin / grokLoginStatus / cancelGrokLogin`: the openaiaccounts ChatGPT session shape
     (fresh dir, reserved slot, anti-litter, watchdog, force-kill, reaped session), device mode only,
     no reauth in this PR. It spawns `grok login --device-auth --leader-socket <tmpdir>/kgrok-<id>.sock`
     with GROK_HOME=<dir> and XAI_API_KEY removed from its env. On exit 0 the account must read back
     as a subscription row, or it is an error and the dir is cleaned.
   - Slot safety both ways: an API-key add skips (unlabelled) or refuses (named) a dir a pending
     sign-in holds (`isSignInPending`), and a sign-in skips or refuses a dir an API-key add has claimed.
     The claim file's name and staleness live in `engine/accountclaim.js`, one copy for both.
   - Header corrected: the "Grok has no such file" paragraph predates `grok login`.
2. `server.js`: `POST /api/accounts/grok/subscription/start`, `GET .../status`, `POST .../cancel`,
   mirroring the openai routes, including the needsRunner answer.
3. `bin/agent-supervisor.sh` grok arm: an agent whose account home (GROK_HOME, or ~/.grok for the
   default) has an auth.json and NO key file drops every `XAI_API_KEY=` entry from PANE_ENV and launches
   through `/usr/bin/env -u XAI_API_KEY`, so neither the secrets/env door nor a server-global value turns a
   subscription agent into an API-key one.

## Decided, and why
- Device mode only: the board is headless-friendly and the measured flow is device auth. `--oauth`
  (browser) was not measured.
- No live network check for a subscription. The one candidate (`grok models`) does not prove a
  sign-in works: with an EMPTY key it still listed models. Refreshing a live token from a probe is
  exactly what must not happen. Weakest premise: a refresh_token present does not prove it still works.
  The observed badge covers that.
- The DEFAULT account (~/.grok) follows the same rule (changed in challenge iteration 2). Its row now
  shows the subscription when ~/.grok holds a sign-in, so a default agent must run on that sign-in, or
  the row, the "runs on" attribution and the observed badge would all describe a subscription the agent
  was not using. Weakest premise: a machine with a door key AND a stale ~/.grok sign-in now runs default
  agents on the sign-in; the row shows it, and a lapsed one reads as expired rather than connected.
- The leader socket goes in the temp dir under a short per-sign-in name, not in the account dir: a long
  account name could pass macOS's 104-byte socket path limit there.
- A lapsed subscription is NONE (a local, provable lapse), and create refuses it with sign-in words,
  not "xAI rejected the key".
- Reauth of an existing subscription account is a follow-up (remove and add again works today).

## Verification
- Unit tests with a fake `grok` binary that prints the measured device output and writes an
  auth.json on "approval": the session flows starting, awaiting-code, then connected; cancel; timeout;
  non-zero exit; a sign-in that writes no usable auth.json; slot reservation; anti-litter.
- The supervisor arm is exercised by the existing supervisor test harness with an XAI_API_KEY door file
  present.
- End to end with a real subscription needs a person to confirm the device code. That one step is
  needs-operator; everything else is proven here.
