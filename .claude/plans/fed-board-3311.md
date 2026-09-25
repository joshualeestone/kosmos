# fed-board-3311: the board's federation routes (invite, verify, join)

## Why
Josh 2026-09-25 07:05 (#3311). The Add Project screen (#3312) calls
`/api/federation/{invite,verify,join}`, which no board served (main, 0.6.94, any
branch), so the first click 404'd. And a board holds no account session (#874),
so it could not call the coordinator's session-authed federation routes either.
kosmos-relay `fed-mac-3311` adds Mac-signed `/v1/mac/federation/*` routes; this
is the board half.

## Change
- `engine/federation.js`:
  - `invite` / `verify` sign `/v1/mac/federation/{invite,verify}` through
    `remote.macRequest` (the connector's `mac-request` verb).
  - `verify` remembers the coordinator's snapshot per edge, and maps the
    coordinator's refusal sentences to the page's `reason` keys.
  - A link record (`federation.json`, keyed by project id) with the projects.json
    honest-read rule.
- `server.js`:
  - `POST /api/federation/invite` and `/verify` call the engine.
  - `POST /api/federation/join` creates the joined project from the verified
    snapshot (never the page's words), records `{role:'member', edge_id, ...}`,
    and tells the receiver's agents the way create does.
  - `POST /api/projects` records `{role:'owner', ref}` when the page sends
    `federation_ref`.
- `web/index.html`: sends `federation_ref` on create only when an invite was
  minted with it (the ref used to be discarded, so an owner could never find
  their room).

## Depends on
kosmos-relay `fed-mac-3311`: the Mac-signed routes, plus the connector allowing
them in `mac-request` (MAC_REQUEST_ROUTES). A board on an older connector gets the
connector's own refusal as the error, which the page shows.

## Verified
- `engine/federation.test.js`: request shapes, bad input refused before
  signing, refusals mapped to reasons (the coordinator's own sentences), the
  snapshot remembered and forgotten, the link record refusing to overwrite a
  damaged file.

## Not in this change
The message path (connector `fed-room` role, board forwarding, rendering) is the
next change. End-to-end sealing of messages has no key scheme yet; tracked
separately.

## Screen-only (from the kosmos-relay fed-mac-3311 review)
The connector's `mac-request` now signs invite and verify, so a local process
(an agent included) could reach them in one command. The board's
`/api/federation/{invite,verify,join}` therefore act only for a person at the
screen (`isViaScreen`, the #3595 line); a process gets 403 before anything is
signed. Advisory, as #3595 records: a process can present the browser header.

`server.federation-3311.test.js` (6, sandboxed, connector stubbed): the 403 for a
process with nothing signed; invite from the screen; verify then join names the
project from the coordinator snapshot (a stray page `name` is ignored) and the
snapshot is spent; an unverified edge is refused; a verify refusal arrives as its
reason; create with `federation_ref` records the owner link, and without it
records none and claims none. Control: removing the gate from invite/verify reds
the first test.
