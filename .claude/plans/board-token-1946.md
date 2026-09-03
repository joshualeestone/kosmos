# board-token-1946: authenticate the loopback board so another macOS account cannot reach it

## The problem (kosmos#1946)

The board binds `127.0.0.1`, which is machine-local, not account-local. Its entire
write surface (`POST /api/agents` installs a launchd job running Claude with
`--dangerously-skip-permissions`; `POST /api/project/:id/thread/:agent` types into a
live agent; role/avatar/boot-file writes) plus the read surface (`GET /api/status`)
is gated ONLY by `isLoopbackPeer` (socket peer == loopback). A second macOS account
on the same Mac connects from `127.0.0.1` and passes that gate with no credential:
that is code execution as another user, not just data disclosure. #910 gave each
account a different DEFAULT port, which stopped ACCIDENTAL cross-account bleed, but a
per-account port is not a security boundary (the port is a deterministic function of
uid, uid is world-readable via `dscl`, the window is scannable).

Proven in `/private/tmp/.../proof-1946-noauth.js`: a synthetic cross-account loopback
peer reaches `POST /api/agents` with no token, control (remote peer) refused.

## The fix: a filesystem-gated capability token

Lean on the boundary macOS actually enforces per account: the filesystem. The board
generates a random token at boot, writes it mode-600, and requires it on every
request. Another account reaches the port but cannot read the token file.

### Why it has ZERO test/browser-check churn (the load-bearing design choice)

Enforce the token ONLY when the board is NOT fully sandboxed. `engine/sandbox.js`
already defines the predicate, and the partial-sandbox guard at server.js boot means a
booting board is EITHER fully-live (prod, `set.length===0`) OR fully-sandboxed
(`set===4, live===0`), never partial. Verified: all 11 board-booting integration tests
and `boot_board` / self-booting browser-checks set the full sandbox env
(DATA/WORKERS/LAUNCH/PROJECTS + a fake TMUX_BIN), and zero use HALF_SANDBOX_OK. So:
- prod board => not sandboxed => token ENFORCED.
- every test + browser-check => fully sandboxed => guard INERT => nothing to change.
This is NOT a naive fail-open: the disable is gated on the board being fully sandboxed
(all real data/launch/workers/projects redirected + tmux stubbed), which the real
installer/launcher provably never does. An attacker cannot set the sandbox env on the
victim's already-running board; the guard is decided at the victim board's own boot.

## Implementation

### engine/boardauth.js (new, pure + unit-testable, like remoteWriteGuard)
- `fullySandboxed(env)` (or reuse from sandbox.js): `live.length===0 && set.length>0`.
- `enforced(env)` = `!fullySandboxed(env)`.
- `tokenPath()` = `store.ROOT + '/board.token'` (ONE source of truth for the path).
- `ensureToken()`: read tokenPath; if absent/empty, generate `crypto.randomBytes(32).toString('hex')`, write mode 0o600 in a 0o700 dir; return it.
- `readToken()`: read tokenPath or null.
- `presentedToken(req, ROUTING_BASE)`: cookie `kosmos_board` || header `x-kosmos-board-token` || `?token=` query.
- `matches(a, b)`: `crypto.timingSafeEqual`, length-guarded (return false on length mismatch).

> SHIPPED DELTA (recorded so this plan does not misdescribe the code): the
> `GET /api/health` exempt probe below was NOT built. It was unnecessary once the
> boundary was scoped to gate `/api/*` while leaving the static shell `/` PUBLIC:
> `healthy()` and setup.sh keep probing `/` (which stays reachable on an enforcing
> board and works on older boards with no `/api/health`). Ignore the `/api/health`
> mentions below; the shipped exemptions are the static shell, `/icons/*`, and
> `REMOTE_AGENT_ROUTES`.

### server.js
- Module scope (after the sandbox audit block): `const boardauth = require('./engine/boardauth'); const BOARD_AUTH = boardauth.enforced(process.env); const BOARD_TOKEN = BOARD_AUTH ? boardauth.ensureToken() : null;`
- In the dispatch, after `remoteWriteGuard` (so remote agents on report/reply are handled first), add the board-auth guard:
  - Exempt: `REMOTE_AGENT_ROUTES` (own agent-token auth) and `GET /api/health` (contentless).
  - `presented = boardauth.presentedToken(req, ROUTING_BASE)`.
  - If `!presented || !boardauth.matches(presented, BOARD_TOKEN)` => `sendJson(res, 403, {error: one sentence})`; return.
  - If it came via `?token=` query (and no cookie yet) => `res.writeHead(302, {location: <path with token stripped, other params kept>, 'set-cookie': 'kosmos_board=<tok>; HttpOnly; SameSite=Strict; Path=/'})`; return.
  - Else proceed.
- Add `GET /api/health` => `sendJson(res, 200, {ok:true, app:'kosmos'})` (no account data), exempt.
- Export `boardauth` pieces or a `boardAuthGuard` pure fn for the test.

### install/kosmos
- `board_token()` helper: read the token via the one-source path: `node -e 'process.stdout.write(require("<abs>/engine/store").ROOT)'` + `/board.token`.
- `healthy()` (261) and the probe at 269: curl `$URL/api/health` (exempt), match `"ok"`.
- Add `-H "x-kosmos-board-token: $(board_token)"` to the loopback-only routes that are NOT report/reply: msg (487), post (602), whoami (673), room (814). Leave report (761) and reply (548) — they are REMOTE_AGENT_ROUTES, exempt.
- `cmd_open` (392): open `$URL/?token=$(board_token)`.
- Add internal `kosmos print-board-token` for the native app.

### native-app/main.swift
- Before `webView.load(URLRequest(url:url))` (396 and 533), append `?token=<token>` to `urlString`, token from `kosmosBin print-board-token` (one source). swiftc-syntax-check only; runtime-verify is the reviewer/deployer's step (flagged in PR).

### install/setup.sh
- If it has its own board health curl, point it at `/api/health`. Verify during build.

## Tests (engine/boardauth + a server guard test), the card's control
- `boardauth.test.js`: matches() timing-safe + length guard; enforced() true when not sandboxed, false when fully sandboxed; ensureToken() writes mode-600 and is stable across calls; presentedToken() reads all three sources.
- Guard control (pure, enforced=true regardless of process sandbox): no token => 403 (the dangerous answer the card wants: a cross-account request with no token is REFUSED); right token => proceed; wrong token => 403; REMOTE_AGENT_ROUTES + /api/health exempt.
- Perturbation: flip enforced=false (simulate sandbox) => no-token request proceeds (proves the guard is load-bearing, not vacuous). And a full-sandbox env => enforced()===false (proves zero churn is real).
- Run the FULL node suite: it must stay green with no per-test changes (the whole point).

## What I cannot validate here (flag in PR, do not let it gate the mechanism)
- The live two-account serving/refusal test: this machine has one account; Splinter is routing a deliberate two-account demo to Josh. Do NOT run it against anyone's real board.
- The native-app runtime (only swiftc syntax-check here). Reviewer/deployer verifies Kosmos.app opens before deploy.
- Upgrade hiccup: an already-open browser tab loses its cookie when the board restarts on update; re-open via the app / `kosmos open`. Note in PR.

## Delivery reminder
Kosmos deploy is Angel / Mona Lisa. PR open for review, NOT self-merged.
