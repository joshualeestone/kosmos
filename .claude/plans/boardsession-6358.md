# boardsession-6358: the dashboard's and the Mac app's sign-in is a session the board holds (kosmos#6358)

Card: kosmos#6358 (follow-up to #1765). Details of the review are kept private; this file states the design.
Stacked on boardproof-1765 (merge order: boardproof-1765, bpbridges-1765, then this).

## What changes
- `engine/boardauth.js`:
  - `bootstrap()` (the `?boot=` nonce and the `?token=` paths) mints a session and sets the cookie to it. A session
    is 32 random bytes as hex. It lives in the board process's memory only, remembers the token it was minted from,
    and ends at a 7-day cap or when the board restarts.
  - `tokenOk` / `tokenOkAny` look a cookie up as a session and never compare it to the board token. Header and query
    tokens are unchanged.
  - A cookie that is no live session (the old cookie, which held the token, or one a restart forgot) no longer stops
    `?boot=` / `?token=` from signing in again.
  - `bootstrap()` takes an optional `accepts(t)`.
- `server.js` (the bootstrap call only): passes `accepts`, the gate's own `boardTokenOk` on the token as a header.
  So a `?token=` of another of this account's worlds (#3055) signs in, with that world's session.
  - Needed because a world switch restarts the board, and the Mac app signs in with the default world's token.
- `native-app/main.swift`:
  - A `kosmosSignin` message from the board's own main frame makes the app load the board's page again with
    `?token=` (read from board.token on the spot). At most once a minute, never on a connect computer, and the URL is
    never logged.
  - Not `loadBoard()`, which runs `kosmos start`.
  - The throttle is pure, with three `--kosmos-app-mode-selftest` rows (115 in all).
- `web/index.html`: on the poll's 403, inside the Mac app, tell the app once per sign-out (`signedOutTellApp`); a 200
  resets it. A browser tab has no bridge.

## Decided
- **Sessions in memory, not persisted.** A restart ends them, by design. Persisted sessions would avoid signing in
  again after a restart, but would keep a session alive across it.
- **The app signs itself back in; a tab does not.** A tab keeps its signed-out panel and needs `kosmos open` after a
  restart. The Mac app is the main surface. Reversible.
- **Rejected:**
  - the page proving the board before each poll (it would not cover a reload);
  - the app serving the board through a scheme handler (a large rewrite; kept as a next step);
  - a port in the cookie name (cookies cannot be scoped by port).

## Checks
- The engine unit tests (boardauth 1946, 1979, 3055) are rewritten to the new contract, with new arms:
  - the token itself in a cookie is refused;
  - a dead session re-bootstraps;
  - the cap;
  - another world signs in only when the gate accepts it.
- Mutants: a gate that also took the token cookie fails on the refusal assertion.
- `web.signin-again-6358.test.js`: the page tells the app once and again after a 200, a tab is told nothing, the poll
  wiring is pinned, and the app proxy checks the origin before acting and logs no URL. Three mutants each fail their
  own assertion.
- The app builds against the macOS floor; `--kosmos-app-mode-selftest` passes 115/115.
- The server tests that sign in with a cookie take their session from the bootstrap: server.board-auth-1946 and
  -worldswitch-3055.

## Weakest premise
That nothing other than a browser sends the board cookie. Every CLI and node sender uses the token header (checked:
the only token-bearing curl in install/kosmos is in kosmos_curl, and the bridges send headers). A sender that set the
cookie to the token would now be refused.

## Not done here
- Measuring a link from the dashboard to another 127.0.0.1 port (queued).
- The Windows app's WebView2 sign-in (Homer's).
