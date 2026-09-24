# kosmos#3555 — remove "coordinator" from user-visible Kosmos copy

## Goal
Josh (2026-09-24): "We were supposed to move away from coordinator language" — the
2026-08-30 rename of `coordinator.kosmosplus.com` to `login.kosmosplus.com`. Sweep
user-visible strings for "coordinator" and reword in product language; leave internal
identifiers, env names, file names and code comments alone unless they leak into UI or a
log a user reads. List what changed and what was kept.

## Approach
Classify every "coordinator" occurrence in the served surfaces (web/index.html, engine/,
server.js, install/setup.sh + installer screens, the login.kosmosplus.com site) as
user-visible copy vs internal. Reword only the user-visible ones. The user-visible path
in the app is `engine/remote.js` `because:` values, which `server.js` relays to the board
UI as `{ error }`.

## Changed
`engine/remote.js` — 6 user-visible strings:
- the retire/forget message (611): "the coordinator could not be told" -> "your Kosmos+
  account could not be updated".
- 5 sign-in errors (868/874/885/1032/1035): "the coordinator did not ..." -> "Kosmos+
  sign-in did not ...".

## Kept (internal)
- All 29 `coordinator` in web/index.html are HTML/JS comments.
- `--coordinator` CLI flag, `COORDINATOR()` getter, `AGENT_WORKFORCE_TUNNEL_COORDINATOR`
  env, launchd labels / plist / file paths (fleet-monitors.js), code comments
  (remote.js / server.js / mac-standing.js), the `updating.js:233` `#988`-prefixed
  diagnostic stderr.
- roles.js "recruiting/family coordinator" — a job-title word, unrelated to the server.
- The served login.kosmosplus.com pages (chaoskosmos-site/plus.html) are already clean;
  only internal design mocks there mention it.

## Follow-up (my lane, separate repo)
The kosmos-relay tunnel client (crates/tunnel/src/coordinator.rs:161/163/166,
devices.rs:143) emits user-visible "coordinator" error strings that surface through
remote.js as `because`. Companion fix in kosmos-relay; ships when the kosmos-tunnel
connector is rebuilt.

## Weakest premise
That server.js's `{ error: because }` relay is the only path carrying remote.js strings
to the user. Mitigated: a blind reviewer independently swept every quoted/`because:`
string in the served code and found no other user-visible "coordinator".
