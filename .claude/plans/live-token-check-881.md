# Kosmos's Connected status does not mean the token works (#881)

Follow-up from #874. That fix addressed a per-agent, screen-scrape signal
(a stuck Claude Code process retrying a rejected token). This card is the
separate bug #874 deliberately did not touch: `engine/subscription.js`
never makes a live call to Anthropic, and Settings > Accounts can show
"Connected" for an account whose token no longer works. Likely the same
root cause behind Josh's separate symptom: "I'm connected to two accounts
but it's not allowing me to access them."

## Found while reading the code: the bug is worse than the ticket says

The Settings > Accounts "Connected" badge (`web/index.html`, the
`acct-connected` span in the account-row renderer) is **hardcoded,
unconditional markup** -- it is not wired to any check at all, not even
the existing weak file-based one. Every account row always renders
"Connected" regardless of any actual state. So the practical fix has two
layers, and both matter:

1. **Wire the badge to a real per-account check at all** (currently:
   none). This alone is the bigger, more urgent fix.
2. **Make that check live**, not just a local file read (the ticket's
   actual ask).

## Research done before writing any code

### Where the real credential lives

`engine/subscription.js` reads `~/.claude.json`'s `oauthAccount` block,
which is profile metadata only (email, org, plan tier) -- confirmed by
reading the actual keys on this machine. **There is no bearer token in
that file.** The real OAuth token lives in macOS Keychain, service name
`Claude Code-credentials` (confirmed via `security find-generic-password`
on this machine), holding `claudeAiOauth.{accessToken, refreshToken,
expiresAt, scopes}`. Multi-account installs get per-account suffixed
service names (`Claude Code-credentials-<hash>`).

**Decided against**: touching Keychain directly from `engine/`. That
would be a new, security-sensitive access pattern this codebase has never
needed before, and guessing at Anthropic's internal profile/validation
API endpoint to call with that token would be exactly the kind of
undocumented-surface guess this house avoids.

### The actual mechanism: `claude auth status --json`

Claude Code ships a documented, first-party command for exactly this
question. Confirmed by direct testing on this machine:

- Logged in: `claude auth status --json` -> `{"loggedIn": true, "authMethod": "claude.ai", "apiProvider": "firstParty", "email": "...", "orgId": "...", "orgName": "...", "subscriptionType": "max"}`, exit 0.
- Not logged in (tested against a fresh, never-used `CLAUDE_CONFIG_DIR`,
  never against the real account): `{"loggedIn": false, "authMethod": "none", "apiProvider": "firstParty"}`, exit 1.

This is the "who am I" call `tokendoor.js`'s `ask()`/`verify()` and
`githubdevice.js`'s `state()` are built from -- except Anthropic already
ships it as a supported CLI subcommand, so there is no need to hand-roll
an HTTP call or touch Keychain ourselves. Anthropic, not this codebase,
owns the credential handling.

### Per-account scoping, for free

`engine/accounts.js`'s own header already documents `CLAUDE_CONFIG_DIR`
as the env var that selects which directory a Claude Code process reads
its config from -- the exact seam `subscription.check()`'s `configDir`
option already uses. Confirmed: `CLAUDE_CONFIG_DIR=<dir> claude auth
status --json` checks THAT account, and its own response names which
account it checked (`email`/`orgId`). This closes the ticket's "hard
part" (cross-account attribution) using a mechanism that already exists
in this codebase, not new plumbing.

### The cadence question, resolved by tracing actual callers

`engine/accounts.js`'s `list()` has TWO call sites with very different
frequency requirements:

- `server.js:962`, inside the 5-second board-status tick (comment: "One
  list read per poll rather than per agent... waste the five-second poll
  would pay forever"). A live subprocess call here, once per account,
  every 5 seconds, forever, is exactly the shape `subscription.js`'s own
  header warns against for the FILE read, and would be worse for a live
  network/subprocess call.
- `server.js:2508-2517`, the `GET /api/accounts` route -- confirmed via
  `web/index.html` that every caller of this route (`paintAccounts`,
  `paintConnLive`, `paintAccountPicker`, and the post-share/post-add
  refreshes) fires on a deliberate action (opening the Accounts settings
  section, adding an account, sharing history) or a single post-action
  refresh -- never a poll loop.

**Decision: do not touch `accounts.list()`** (keep it exactly as fast and
sync as it is today, for the tick's sake). **Add a new, separate
`accounts.listLive()`**, used only by the `GET /api/accounts` route,
that layers a live check onto each row `list()` already returns. This is
the same shape `githubdevice.js`'s `state()` already uses -- a live call
on every invocation, safe specifically because invocation is rare and
deliberate, not ticked.

## Design

### `engine/subscription.js`: `checkLive(opts)`

New exported async function, alongside the existing `check()`/
`checkCached()`:

- Runs `claude auth status --json` via `child_process.execFile`, scoped
  to `opts.configDir` through `CLAUDE_CONFIG_DIR` when given (mirroring
  `check()`'s own `opts.configDir` contract exactly).
- Own test seam (`setRunner`/`setDryRun`), matching the established
  precedent in `engine/connect.js` (`run`), `engine/tokendoor.js`
  (`fetcher`), and `engine/githubdevice.js` (`fetcher`) -- each external
  I/O boundary in this codebase gets its OWN independently-controllable
  seam rather than a shared one, so one module's test suite can never
  leak state into another's. NOT reusing `connect.js`'s `run()`/
  `claudeBinPath()` directly (they are module-private, not exported, and
  carry connect.js's own dry-run-refuses-without-a-runner interlock tied
  to ITS OWN test lifecycle) -- a small, deliberate duplication of an
  already-proven shape, not a new pattern.
- Timeout: 8000ms, matching `tokendoor.js`'s `ask()`.
- Maps `claude auth status`'s output to the SAME three-state enum
  `check()` already uses (`STATE.CONNECTED` / `STATE.NONE` /
  `STATE.UNKNOWN`), never a fourth ad-hoc shape:
  - `loggedIn: true` -> `CONNECTED`, `because: 'Anthropic confirmed this account is signed in'`.
  - `loggedIn: false` -> `NONE`, `because: 'Anthropic says this account is not signed in'`.
  - Unparseable output, timeout, or the `claude` binary missing -> `UNKNOWN`
    (never `NONE` -- this is exactly the "we cannot tell" case the file's
    own header calls out as the highest-stakes distinction: never render
    "unsure" as "not connected"), with a `because` naming which of the
    three happened.
- Returns `{ state, plan, because, checkedLive: true }` -- the
  `checkedLive` flag lets a caller (or a future screen) tell a
  live-verified result apart from `check()`'s file-only one, without a
  second, parallel state enum.

### `engine/accounts.js`: `listLive()`

New async function: calls the existing sync `list()`, then for each row
calls `subscription.checkLive({ configDir: row.dir })` (parallel via
`Promise.all`, not serial -- a settings page with 3 accounts should not
pay 3x8s worst-case sequentially), attaching the result as
`connection: {state, because}` on each row. `list()` itself is
UNTOUCHED.

### `server.js`: `GET /api/accounts`

Route becomes `async`, calls `accounts.listLive()` instead of
`accounts.list()`. Every other route/caller of `accounts.list()`
(the status tick, the share/openai POST handlers, `engine/create.js`)
is untouched -- confirmed by re-reading each call site before deciding
this was safe to leave alone.

### `web/index.html`: the account row renderer

Replace the unconditional `'<span class="acct-connected">...Connected</span>'`
with a conditional render on `a.connection.state`:
- `connected` -> the existing green-dot "Connected" markup, unchanged.
- `none` -> a real "Not connected" treatment (new, since none existed).
- `unknown` -> a "we could not check just now" treatment, distinct from
  both -- the third state, applied here the way #874 applied it to the
  chat pane.

## Verification plan

- `engine/subscription.test.js`: new cases for `checkLive()` via the
  injected runner -- logged-in, logged-out, timeout, unparseable output,
  binary-missing (ENOENT), and the `configDir`-scoping (confirm the env
  var is threaded through, not that a real subprocess reads it).
- `engine/accounts.test.js`: new cases for `listLive()` -- multiple
  accounts each get their own live-checked connection field, a failure
  on one account's check does not fail the others (`Promise.all`
  behavior with per-item catch, not a single rejection sinking the
  whole list), and `list()` itself is unchanged (same test fixtures,
  same assertions, still pass).
- `server.connect.test.js` or a new accounts-route test: `GET
  /api/accounts` returns the live connection field; the omnipresent
  status-tick path (whatever test already covers `server.js:962`) is
  unaffected -- confirmed by running the full suite, not just the new
  tests.
- Manual/real-machine confirmation (this machine, real account, no
  fixture): `checkLive()` against this machine's real default account
  returns `CONNECTED` with `checkedLive: true` in well under the 8s
  timeout -- proof the mechanism works end to end, not just against
  mocks.

## Real bug found while wiring the default account (caught before shipping)

Confirmed live, not assumed: `engine/accounts.js`'s own `configFile()`
already special-cases the default account -- its record lives at
`<HOME>/.claude.json`, a file BESIDE `<HOME>/.claude`, never inside it
(`accounts.test.js`'s own header already documents this: "There is no
`~/.claude/.claude.json`"). The real `claude` binary, given
`CLAUDE_CONFIG_DIR=<dir>`, looks for `<dir>/.claude.json` -- confirmed on
this machine with three real accounts: pointing it at `.claude-account-b`
and `.claude-account-c` (non-default, `dir/.claude.json` is genuinely
where their records live) correctly answered `loggedIn: true` for each;
pointing it at `.claude` (the default) answered `loggedIn: false`, because
`.claude/.claude.json` on this machine is a stale, 464-byte decoy file
sitting beside the real, 132KB, actively-updated `.claude.json` at the
sibling path `check()` already knows to read.

Had this shipped as first written (`checkLive({ configDir: row.dir })` for
every row uniformly), the SINGLE MOST COMMON case -- the default account,
signed in and working -- would have ALWAYS shown "Not connected". That is
the exact "tell a paying customer they are not connected" failure
`subscription.js`'s own file header is built to prevent, reintroduced by
the very feature meant to catch a milder version of it.

**Fix**: `listLive()` omits `configDir` entirely for the row where
`isDefault === true`, letting `claude auth status` fall through to its own
built-in default resolution (confirmed live: this correctly lands on the
real account) rather than pointing it at a directory whose `.claude.json`
Kosmos itself has never treated as the real file. Every non-default row is
unaffected -- `configDir: row.dir` was already correct for those,
confirmed against two real, distinct signed-in accounts on this machine.

Verification added: `accounts.test.js`'s new `listLive()` tests assert
specifically that the default row's live check runs with NO
`CLAUDE_CONFIG_DIR` override while non-default rows are scoped to their
own directory -- the assertion that would have caught this had it not been
caught by hand first.

## Deliberately not done here

- Not touching the omnipresent 5-second status tick (`server.js:962`,
  `accounts.list()`) -- traced and confirmed a live check there would be
  the exact anti-pattern `subscription.js`'s own header warns against.
- Not adding Keychain access to `engine/` -- `claude auth status`
  already owns that safely; duplicating it would be new attack surface
  for no benefit.
- Not building a coarser TTL cache for `checkLive()` (the way
  `checkCached()` exists for the file read) -- the route it feeds is
  already rare/deliberate (settings-page open, not a poll), so a cache
  would add complexity for a cost that isn't being paid. Revisit if a
  future caller wants this on a tighter loop.
