# fedlive-4649: read the federation-live flag from the coordinator (kosmos#4649)

## Why
Weekend goal #4647 (#4649 milestone 3): turn on the built-but-hidden federation. The shared-room screens show
only when federation is live, and the board's `fetchFederationLive` was a null stub, so they showed only with
`AGENT_WORKFORCE_FEDERATION_LIVE=1`. The switch belongs on the coordinator (`KOSMOS_FEDERATION_LIVE`,
published as `federation_live` on its public `GET /v1/meta`, kosmos-relay #213).

## This branch
- `engine/remote.js`: `fetchFederationLive` reads `federation_live` off `GET /v1/meta` with a 5 s timeout,
  redirects refused, only a JSON answer parsed. Anything but a boolean is null, which keeps the last-known value
  and the hidden default: exactly the old stub, so it is safe before the coordinator publishes the field.
- Only a board whose person turned Kosmos+ remote access ON asks, and the flag only counts while it is on.
- `server.js` and `web/index.html`: the comments beside the only caller no longer call it a stub.

## Decided, not missed
- **No call from boards that never opted in.** A live fetch from every open board is about 1,440 calls a day
  to our servers from people who never turned Kosmos+ on. Cost: such a board cannot use the flag for a signup
  prompt (an open product question on #4649).
- **Switching off is an explicit `federation_live:false`**, never a missing field; null keeps the last value.
- **A plain HTTPS read, not the pinned tunnel path**: the flag is display only; the shared-room routes still
  refuse non-members whatever the page shows.

## Done means
The remote suites and `engine/remote-fed-live-refresh.test.js` green (putting the stub back reds them), the
full validation, a converged challenge loop, then the flag flipped on the coordinator for the live run (#4647).
