# boughtaddr-4756: the app's second-computer sign-in to a BOUGHT address (kosmos#4756, the app half of #4754)

Josh 2026-09-30, ruling "A": a new computer is a purchase. The contract with the server half (Ice Cream Kitty) is
kosmos#4754 comment 5916329460; her 12:50 differences (no buy_url on the 402, price null, a cancelled checkout's
hold ends by itself, now after 33 minutes, her review 3) change nothing this branch relies on.

## What changes
- engine/remote.js: `fetchMetaFlag(field)` (federation_live keeps its wrapper) and `signinAddresses()`: with a held
  sign-in session and bought addresses live (/v1/meta bought_addresses, or AGENT_WORKFORCE_BOUGHT_ADDRESSES=1),
  reads GET /v1/account/addresses THROUGH THE TUNNEL BINARY (`kosmos-tunnel signin addresses --coordinator <url>`,
  the session token on stdin, the coordinator reached on its pinned key), exactly as `signin register` spends it.
  Rows only in their own shapes, https buy link only. No session: no call at all. Only the switch (/v1/meta) is a
  plain request, because it carries no credential.
  NEEDS a tunnel verb from the server half (Ice Cream Kitty): `signin addresses`, token on stdin, prints the
  coordinator's JSON on one line, exits non-zero with "Kosmos+ said no (<code>): <words>" on a refusal. Until it
  exists the read fails and the page takes the step as before.
  Rejected (review round 15): a direct HTTPS request with the token as a Bearer. It trusts any system CA, so a
  TLS-inspecting proxy would see a token that can register a computer to the account.
- server.js: GET /api/remote/signin-addresses.
- web/index.html: the session step. On the first read, anything but a definite live:true is the step exactly as
  before. Live: the account's first computer, and a computer signing in again to its own address, register as
  before; any other computer, and an account with no address at all, picks one of the account's FREE bought
  addresses (no name field), or, with none, is told so and sent to the website with Check again. A re-read that
  fails stays on the list and says so; one that finds the switch off takes the step as before.
- docs/browser-checks/render-plus-bought-4756.js (gated): one scenario per path of the session step (the list is in
  the file); the control (main's page) fails it.

## Decided
- Fail open to the old step, not closed: the coordinator refuses an address not bought whatever this page shows
  (register_mac / setup_complete, 402 address_not_bought), so the old path can only end on that sentence.
  Rejected: blocking sign-in when the list cannot be read (a coordinator hiccup would strand a first computer).
- Weakest premise: that the server's refusal exists before the flag is turned on. The flag and the refusal are
  one switch on the server (KOSMOS_BOUGHT_ADDRESSES), so they cannot be on apart.
- Not changed here, noted: tools/plus-signin-fresh.js (the agent-run sign-in procedure) posts signin-register directly
  and never reads the list, so once the switch is on it will be refused on a second computer. It is a test tool, not a
  person's path; it follows when the server half lands.
- Refused vs failed: a failed pick counts as refused only on the coordinator's own address sentences ("that name is
  taken", "already in use by a computer on this account", "needs an address you have bought"); anything else keeps
  Try again on the same address. That includes the engine's "may be held by an earlier sign-in on this computer": the
  address is this person's, and once they remove the stale entry on the account page, Try again works.
- ROLLOUT ORDER: the coordinator's switch (KOSMOS_BOUGHT_ADDRESSES) must not go on before a Kosmos build whose
  tunnel binary has `signin addresses` is out. Before that, a second computer still falls back to the old step and
  is refused by the coordinator's 402, which works but is the degraded path. Recorded on kosmos#4754.
- Refusal recognition rests on the coordinator's own sentences (and the `address_not_bought` code, if the tunnel
  prints it). A wording change on the server would turn a refused pick into Try again on the same address: safe,
  not stuck (Sign out still works), but worth a code in the tunnel's output. Asked on kosmos#4754.
- Free first address (her review 3, 14:57 HEADS-UP item 5): an app-made account (no account_address) whose list has no
  this_name and no in_use row that is neither bought nor grandfathered is on its FREE first address, so the name step
  shows as before. Derived from the list's shape, because the list carries no explicit field; asked her for one
  (first_free) and will prefer it if it lands. A 402 not-bought refusal goes to the list and pins "not free" for the
  sign-in. Weakest premise: that the grandfathered/bought_at fields keep exactly this meaning on the server.
- Item 3 (a web-claimed name is the first computer's only choice) already held: account_address hides the name field
  and registers to it by itself (plusSiAsBefore, PLUS_SI_OWNED). Covered by the first-computer scenario.
