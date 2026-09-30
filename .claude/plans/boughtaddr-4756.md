# boughtaddr-4756: the app's second-computer sign-in to a BOUGHT address (kosmos#4756, the app half of #4754)

Josh 2026-09-30, ruling "A": a new computer is a purchase. The contract with the server half (Ice Cream Kitty) is
kosmos#4754 comment 5916329460; her 12:50 differences (no buy_url on the 402, price null, a cancelled checkout's
hold ends by itself after 31 minutes) change nothing this branch relies on.

## What changes
- engine/remote.js: `fetchMetaFlag(field)` (federation_live keeps its wrapper) and `signinAddresses()`: with a held
  sign-in session and bought addresses live (/v1/meta bought_addresses, or AGENT_WORKFORCE_BOUGHT_ADDRESSES=1),
  reads GET /v1/account/addresses with the session as a Bearer, rows only in their own shapes, https buy link only.
  No session: no call at all.
- server.js: GET /api/remote/signin-addresses.
- web/index.html: the session step. Anything but a definite live:true is the step exactly as before. Live: the
  account's first computer, and a computer signing in again to its own address, register as before; any other
  computer picks one of the account's FREE bought addresses (no name field), or, with none, is told so and sent
  to the website with Check again.
- docs/browser-checks/render-plus-bought-4756.js (gated): six scenarios; the control (main's page) fails.

## Decided
- Fail open to the old step, not closed: the coordinator refuses an address not bought whatever this page shows
  (register_mac / setup_complete, 402 address_not_bought), so the old path can only end on that sentence.
  Rejected: blocking sign-in when the list cannot be read (a coordinator hiccup would strand a first computer).
- Weakest premise: that the server's refusal exists before the flag is turned on. The flag and the refusal are
  one switch on the server (KOSMOS_BOUGHT_ADDRESSES), so they cannot be on apart.
