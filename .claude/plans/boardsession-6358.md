# boardsession-6358: the dashboard's and the Mac app's sign-in is a session the board holds (kosmos#6358)

Card: kosmos#6358 (follow-up to #1765). Details of the review are kept private; this file states the design.
Stacked on boardproof-1765 (merge order: boardproof-1765, bpbridges-1765, then this). The proof route answering for
sessions (Renet's part of #6358, using `liveSessionIds`) lands after this.

## What changes
- **`engine/boardauth.js`**
  - `bootstrap()` (the `?boot=` nonce and the `?token=` paths) mints a session and sets the cookie to it.
    - A session is 32 random bytes as hex, held in the board process's memory only.
    - It remembers the token it was minted from.
    - It ends at a 7-day cap or when the board restarts.
    - At most 1000 exist; past that, the one minted longest ago ends first (by age, not by use).
  - `tokenOk` / `tokenOkAny` look a cookie up as a session and never compare it to the board token. Header and query
    tokens are unchanged.
  - A valid `?boot=` / `?token=` is always answered with a redirect to the clean address, a live session or not, so
    an address never keeps the token (the app reads a kept `token=` as a refusal). A live session already the
    signing-in token's is kept; a cookie that is no live session (the old token cookie, or one a restart forgot) is
    no sign-in. The clean address has no sign-in parameter, so there is no redirect loop.
  - New exports:
    - `accepts(t)` (on bootstrap) and `clearedCookieHeader()`;
    - `liveSessionIds()`, for the proof route, which does not call it yet;
    - `SESSION_MAX_MS`, `SESSION_MAX_COUNT`.
- **`server.js`**, in the bootstrap code only:
  - Passes `accepts`, the gate's own `boardTokenOk` on the token as a header. So a `?token=` of another of this
    account's worlds (#3055) signs in, with that world's session. Needed because a world switch restarts the board,
    and the Mac app signs in with the default world's token.
  - Ends (`Max-Age=0`) a cookie whose value is one of this account's tokens in memory (the active one and the worlds known at start): the cookie given out
    before sessions. A live session, or a cookie that is no token here (another board's), is left alone.
- **`native-app/main.swift`**
  - A `kosmosSignin` message, from the board's own main frame only (`isBoardOrigin`), makes the app sign the window
    in again by loading the board with `?token=`. The token is read from board.token on the spot.
  - Never on a connect computer, and not `loadBoard()`, which runs `kosmos start`.
  - `signInAgainPage`: the page it was on only when that is this board's own origin (plain http, its host and port,
    no user), with any stale `token=` / `signin=` dropped. Anything else, Kosmos+ pages included (`isBoardPage` counts
    those), gets the board's front page. With no board token, it does not reload.
  - `signInAgainDecision`: sign in at most once a minute, and give up once when the board REFUSED the sign-in or
    there is no token. Refusal is read from the board's own answer (`signInWasRefused`): an accepted `?token=` is
    redirected to the clean address, a refused one is not, so the committed page still carries `token=`. A second
    restart or a down board is no refusal, so the app simply signs in again.
  - Giving up loads `?signin=failed` without the token; the page reads that marker at load, before boot's `syncUrl`
    rewrites the address. The app then stays out of it until a read works, which in
    practice means Kosmos is reopened.
  - `urlForLog` keeps the token out of the two launch log lines.
  - All pure, with `--kosmos-app-mode-selftest` rows: 135 in all. The reload log line goes through `urlForLog` too.
- **`web/index.html`**
  - On the poll's 403, inside the Mac app (or the Windows app, `{ kosmosSignin: true }`), tell the app
    (`signedOutTellApp`). Not on every poll: again after 65 s, a little over the app's own limit, and at once after a
    200. A browser tab has no bridge.
  - `platformCopy` takes a Linux entry where the Linux table has one; every other key keeps the Mac words on Linux,
    as before.

## What a person sees after a restart (Splinter 05:12, both checked)
- **The Mac app:**
  - The panel reads "Kosmos restarted, so the app is signing this window in again", and the app reloads the page it
    was on.
  - Accepted cost: the reload drops text typed and not yet sent. Off a board page it falls back to the front page
    without `?mode=`.
  - If the board refuses the sign-in, or the window is still signed out 150 s after it first told the app (well past the 65 s retell plus a poll): "Kosmos
    could not sign this window in. Quit Kosmos with Command-Q, then open it again from your Applications folder." No
    reload loop, and no "this takes a moment" that never ends.
- **A browser tab on a Mac (`kosmos open`):** "This board is not signed in. It cannot read your agents or projects.
  Kosmos signs a browser tab out each time it restarts or updates, and after seven days. To keep going, open Kosmos
  from your Applications folder: the app signs itself in. This tab stays signed out until it is signed in again."
  - A disclosure gives the full-path `kosmos open`, then Reload. The browser shares the cookie across its tabs, so
    the old tab works after Reload.
  - The old "it fixes itself the next time Kosmos updates" is gone. It is now false, and render-board-signin-403-2023
    asserts it is absent. That check saves a screenshot when KOSMOS_SIGNIN_SHOT names a file.
- **A browser tab on a Linux board:** run `kosmos open` on the computer running Kosmos, then Reload. A Linux board has
  no app and no Applications folder.
- **The one sentence (agents box, projects, org note):** "The Kosmos app signs itself in again. In a browser tab,
  open Kosmos from your Applications folder." That is true in both places. Linux has its own sentence.
- **Kosmos+ remote access through the relay:** NOT signed out by a restart on the board's side. Read in kosmos-relay
  origin/main, `crates/tunnel/src/proxy.rs`:
  - the connector drops the visitor's `kosmos_board` cookie;
  - it refuses `/api/board-nonce` and strips the bootstrap parameters;
  - it presents the board token as the `x-kosmos-board-token` header, read fresh from board.token on each request.
  - No board session is involved, and a stale cookie no longer shadows that header (the gate falls through to it).
- **The Windows app (WebView2), stated so it is not read as covered:** a restart (or a crash) now signs the window
  out. Before this, its cookie held the token and survived.
  - Its panel says to double-click Kosmos.exe, which signs it back in (the launcher's existing `SignInAgain`): one
    action, never a dead page.
  - The page also posts `{ kosmosSignin: true }`, which today's Kosmos.exe ignores. Answering it automatically is a
    launcher change plus a rebuild on the Windows box (Homer).
  - Until then this is a regression in convenience, accepted for the security gain.

## Decided
- **Sessions in memory, not persisted.** A restart ends them, by design. Persisted sessions would avoid signing in
  again after a restart, but would keep a session alive across it.
- **The app signs itself back in; a tab does not.** The Mac app is the main surface. Reversible.
- **Rejected:**
  - the page proving the board before each poll (it would not cover a reload);
  - the app serving the board through a scheme handler (a large rewrite; kept as a next step);
  - a port in the cookie name: it would stop two boards in one browser from overwriting each other's cookie, but
    not a listener on the same port, which is the case here (kept as a possible next step for many-board browsers).

## Checks
- **Engine unit tests** (boardauth 1946, 1979, 3055) are rewritten to the new contract. New arms:
  - the token itself in a cookie is refused, and a session for another token is refused;
  - a dead session re-bootstraps;
  - the cap, one millisecond either side;
  - the ceiling evicts the oldest;
  - liveSessionIds drops expired sessions;
  - another world signs in only when the gate accepts it, and `accepts` must answer `true` exactly.
- **A mutant** (a gate that also took the token cookie) fails on the refusal assertion.
- **`web.signin-again-6358.test.js`:**
  - the retell timing, and that the retell gap exceeds the app's limit;
  - the Windows post, and that a tab or plain Chrome is told nothing;
  - the poll wiring;
  - the in-app, refused and tab panels;
  - the app proxy's origin check, and that the give-up loads no token.
  - Three mutants were run by hand (not in the suite), each restored after: dropping the poll's call, the
    told-guard, or the proxy's origin check. Each failed its own assertion.
- **`web.win32-board-copy.test.js`:** the Mac copy pin follows the new copy, and a Linux arm was added.
- **The app:** builds against the macOS floor; `--kosmos-app-mode-selftest` passes 135/135.
- **The server tests that sign in with a cookie** take their session from the bootstrap (server.board-auth-1946,
  -worldswitch-3055). 1946 also checks that the old token cookie is ended and a live or foreign one is not.
- The no-URL-in-logs test checks today's spellings only (`\(url`, `absoluteString`, `\(page`). It is not general
  coverage.

## Weakest premise
That nothing other than a browser sends the board cookie. Every CLI and node sender uses the token header. Checked:
the only token-bearing curl in install/kosmos is in kosmos_curl, and the bridges and the relay connector send the
header. A sender that set the cookie to the token would now be refused, and its cookie ended.

## Not done here
- Measuring a link from the dashboard to another 127.0.0.1 port (queued).
- The Windows app answering `kosmosSignin` (Homer).
- The proof route answering for sessions (Renet, after this merges).

## Known limits, stated
- A session minted through `accepts` (another world's `?token=`) passes the gate (`boardTokenOk`, with #3055's other
  worlds) but not the few operator checks that call `tokenOk` with the active token only. That is as before: an
  other-world cookie failed them too.
- `boardproof.tokenIn` still reads the cookie value first, which is now a session id. It fails closed until Renet's
  part of #6358 has the proof route answer for sessions.
