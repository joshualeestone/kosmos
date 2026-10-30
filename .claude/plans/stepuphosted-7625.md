# stepuphosted-7625: a remote session asked for a fresh sign-in can get one from the board, on every connector

Card: kosmos#7625. Found on the #4903 newcomer walk (Angel, 10-30): ten minutes after sign-up a cloud user's first
Create agent is refused `remote_step_up`, and nothing on the board gets them through.

## Cause
#6616's one-press path needs the connector to serve `/_kosmos/signin?fresh=1` and list `fresh-signin`. No connector
does (kosmos-relay crates/tunnel: session, logout, ticket, nonce, tls-pin only; CAPABILITIES has no fresh-signin), so
every remote user got the fallback sentence: sign out in two places, or "do this at the computer itself". The board's
Log out lives in Settings, Kosmos+ and the phone menu, not beside the refusal; a cloud machine has no other computer.

## Change
- server.js: `REMOTE_STEP_UP_LOGOUT` (code `remote_step_up`, `signInAgain: true`, `via: 'logout'`), returned for a
  stale request the gate forwarded when the connector does not list `fresh-signin`. Its fallback names the board's own
  door (Settings, Kosmos+, Log out) and drops "at the computer itself". A request with no gate header keeps
  `REMOTE_STEP_UP`; a connector that lists `fresh-signin` keeps `REMOTE_STEP_UP_SIGNIN`.
- web/index.html: the ask remembers `via`; for `logout`, Sign in again runs `kplusLogout` (the one log out every door
  uses: POST /_kosmos/logout, then the gate's page), and the form's fixed POST stays for a connector that serves it.

## Why this works
After /_kosmos/logout the gate serves its own page (kosmos-relay crates/tunnel/src/gate.html), whose sign-in is new:
email code, authenticator, a new session, then a handoff for this address. It never borrows the sign-in site's session,
so it is fresh. Measured on the walk: a fresh browser profile signed in at that page and passed POST /api/agents.

## Decided
- Board-only, so it works on every connector already shipped, Mac and cloud. Baron's connector route (#6616 part 3)
  is held; it stays possible and the board keeps its form for it.
- Rejected: exempting hosted boxes or a longer window (weakens the step-up); copy only (leaves browser surgery).

## Weakest premise
That the gate's page after Log out never auto-opens from something kept in the tab. Measured directly on a real box
before the PR (Log out, sign in at the gate, Create agent past ten minutes).

## Tests
server.stepupbutton-6616.test.js: the log-out kind through the gate (code, via, words, no "computer itself"), the
proxy CONTROL, the page's submit handler (logs out for `logout`, CONTROL: the fresh kind keeps the form's POST;
mutation of the via check turns it red). server.remotestepup-6595.test.js: gate-forwarded stale requests now expect
the log-out kind. Related readers and render-stepupask-6616.js pass.

## Review ledger (2 blind rounds, converged)
- Round 1: 0B 0W 2N. N1 taken: a gate session with no second factor would sign in again and be refused the same way, so it keeps the plain refusal (no log-out button). N2 kept: after logging out the person returns to / and retries (the sentence says "then try again").
- Round 2: CONVERGED, no blocker or warning (a test comment put on its own line).

## Measured on a real cloud box (10-30 10:48 to 11:03, cloud-6d62aeb4, coordinator 0f80d2013)
CONTROL fresh 400; 11 min old 400 (the board's window is 12); 13 min old 403 remote_step_up; POST /_kosmos/logout 200 plus a reload gave the gate's own "You're signed out" page; email code and authenticator there; then POST /api/agents 400 (passes the gate). This is the path Sign in again runs (kplusLogout reloads, which a fragment-only navigation would not). Posted on #7625.
