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
  - The throttle is pure, with three `--kosmos-app-mode-selftest` rows (123 rows in all now; see below).
- `web/index.html`: on the poll's 403, inside the Mac app (or the Windows app, `{ kosmosSignin: true }`), tell the app (`signedOutTellApp`); a 200
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
  wiring is pinned, and the app proxy checks the origin before acting and logs no URL. Three mutants were run by hand
  (not in the suite), each restored after: dropping the poll's call, the told-guard, or the proxy's origin check, and
  each failed its own assertion.
- The app builds against the macOS floor; `--kosmos-app-mode-selftest` passes 123/123.
- The server tests that sign in with a cookie take their session from the bootstrap: server.board-auth-1946 and
  -worldswitch-3055.

## What a person sees after a restart (Splinter 05:12, both checked)
- **The Mac app:** the page tells the app (`kosmosSignin`). The app reloads the page it was on with `?token=`.
  - The panel reads "Kosmos restarted, so the app is signing this window in again".
  - Accepted cost: the reload drops text typed and not yet sent. When the window was not on a board page, it falls
    back to the board's front page without `?mode=`.
  - The page retells after 65 s, a little over the app's own one-minute limit, so a second restart within the
    minute is not lost (review round 1).
- **A browser tab (`kosmos open`):** "This board is not signed in. It cannot read your agents or projects. Kosmos
  signs a browser tab out each time it restarts or updates. To keep going, open Kosmos from your Applications folder:
  the app signs itself in."
  - A disclosure gives the full-path `kosmos open` command, then Reload: the browser shares the cookie across its
    tabs, so the old tab works after Reload.
  - The old "it fixes itself the next time Kosmos updates" is gone. It is now false, and render-board-signin-403-2023
    asserts it is absent. That check also saves a screenshot when KOSMOS_SIGNIN_SHOT names a file.
- **Kosmos+ remote access through the relay:** NOT signed out by a restart on the board's side. Read in kosmos-relay
  origin/main, `crates/tunnel/src/proxy.rs`:
  - the connector drops the visitor's `kosmos_board` cookie;
  - it refuses `/api/board-nonce` and strips the bootstrap parameters;
  - it presents the board token as the `x-kosmos-board-token` header, read fresh from board.token on each request.
  - No board session is involved. A stale cookie can no longer shadow that header either, because the gate falls
    through to the header.
- **The Windows app (WebView2):** its panel already says to open Kosmos.exe again, which runs the launcher's
  existing `SignInAgain`. The page now also posts `{ kosmosSignin: true }`; the current Kosmos.exe ignores it.
  Answering it automatically needs a launcher change and a rebuild on the Windows box (Homer).

## Also in this branch (review round 1)
- The app no longer writes the tokenized URL to its log on launch: `urlForLog` hides the `token` item (three
  selftest rows).
- At most 1000 sessions; past it, the one minted longest ago ends first (by age, not by use).

## Also in this branch (review round 2)
- The app re-signs in on `signInAgainPage`: the page it was on only when that is this board's own origin, else the
  board's front page. `isBoardPage` also counts Kosmos+ pages, which must never get the token (five selftest rows).
  With no board token to add, it does not reload.
- A cookie whose value the gate accepts as one of this account's tokens (the cookie given out before sessions) is
  ended (`Max-Age=0`) on the first answer that sees it, so an old browser profile stops carrying the token. A cookie
  that is no token here (another board's) is left alone (server.board-auth-1946).
- The one sentence (agents box, projects, org note) is true in both places: "The Kosmos app signs itself in again. In
  a browser tab, open Kosmos from your Applications folder." The tab panel also names the 7-day cap.
- `liveSessionIds()` for Renet's proof route, which will answer for a session as for a token.

## The Windows app, stated so it is not read as covered
A restart (or a crash) now signs the Windows window out. Before this, its cookie held the token and survived. Its
panel says to double-click Kosmos.exe, which signs it back in (the launcher's existing SignInAgain): one action, never
a dead page. Making it automatic is a launcher change plus a rebuild on the Windows box. The page already posts
`{ kosmosSignin: true }`, which today's Kosmos.exe ignores. That is for Homer; until then it is a regression in
convenience, accepted for the security gain.
- The no-URL-in-logs test checks today's spellings only (`\(url`, `absoluteString`, `\(page`). It is not general
  coverage.

## Weakest premise
That nothing other than a browser sends the board cookie. Every CLI and node sender uses the token header (checked:
the only token-bearing curl in install/kosmos is in kosmos_curl, and the bridges send headers). A sender that set the
cookie to the token would now be refused.

## Not done here
- Measuring a link from the dashboard to another 127.0.0.1 port (queued).
- The Windows app's WebView2 sign-in (Homer's).
