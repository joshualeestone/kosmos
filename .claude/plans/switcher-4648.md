# switcher-4648: the top-left menu lists every computer on your Kosmos+ account and opens each (#4648, weekend goal #4647)

## The ask (card, milestone 2 of #4647)
When the board is signed in to Kosmos+, the top-left Kosmos menu also lists every computer on the account, by
name, online or offline, and choosing one opens it. Coming back to "this computer" is one click. Done means: on
Josh's laptop the menu lists all four of his computers and each one opens.

## What exists (measured on main, 2026-09-29)
- The top-left menu (`#worldsw`, worldsFetch/worldswRender in web/index.html) lists only THIS computer's own
  Kosmoses (worlds), and switching restarts the board.
- The coordinator's `GET /v1/account/macs` lists an account's computers, but takes a DEVICE session (a phone or
  browser signed in to the account). A board has no device session: it signs as a computer, with its own key,
  through the tunnel's `mac-request` verb (engine/remote.js macRequest, allowlisted routes).

## The three pieces
1. **kosmos-relay (branch switcher-4648, its own PR):** `POST /v1/mac/account-computers`, computer-signed like
   `/v1/mac/standing`; the account comes from the verified signature; retired computers are left out; read-only.
   The tunnel's `mac-request` allowlist gains that one route. Red-checked: a retired computer offered, "this" on
   every row, and another account's computer leaked each fail the coordinator test.
2. **engine/account-computers.js (this repo):** `fetchComputers()`, modelled on engine/mac-standing.js: the suite
   guard, the on + enrolled gate, `remote.macRequest('POST', '/v1/mac/account-computers', {})`, then an ONLINE
   probe of every other computer's own address.
   - Online is MEASURED, not inferred: an HTTPS request to `https://<address>/` that gets ANY HTTP answer means
     that computer's tunnel is up (the relay forwards to it; measured: Josh's laptop answers 200 with its gate
     page in 0.6 s). A TLS or connection failure means it is not connected (measured: an unknown name fails the
     TLS handshake, curl rc=35, in 0.2 s). A short timeout counts as offline. `last_seen` is NOT used for this: it
     is refreshed only daily and on reconnect.
   - This computer is not probed: it is the one answering.
   - Addresses are trusted ONLY as `<label>.<domain>`, one plain label under the computers' domain, which is
     derived from the Kosmos+ sign-in host exactly as the native app's isKosmosPlusURL does
     (login.kosmosplus.com gives kosmosplus.com), no punycode. The coordinator's ANSWER is not signed, so
     without this a bad answer could make every board probe any host, a LAN address included, and put a link
     anywhere in this menu (review 1). Enforced in the engine BEFORE any probe and again in the page.
3. **server.js `GET /api/remote/computers`** (behind the board's token gate like the other /api/remote routes),
   and **web/index.html**: a "Your computers" section in the same menu, under the Kosmoses. This computer first
   (marked, not a link), then the others by name. Only an ONLINE computer is a link: an offline one would open a
   browser error page (the relay closes a disconnected computer at the TLS handshake, and HSTS keeps it https),
   and an updating one is restarting, so each is a plain row saying so (review 1 corrected an earlier claim here
   that an offline link "opens the relay's own answer"; that page is served on :80 only). Choosing one opens its
   address in the person's browser (a target=_blank link; a run or both Mac sends new windows to the default
   browser). On a connect-only Mac and on the phone the app opens a person's own computer IN its window instead
   (#4356), so there the way back is that computer's own menu. The section is hidden and emptied at the start
   of every read, so a state word from an earlier open is never shown as current. Hidden when the board is not
   signed in to Kosmos+, the list has only this computer, or the answer has no domain.

## Rejected
- Giving the board a device session: a second credential that could act as a browser on every computer, more power
  than listing needs.
- Loading the other computer inside this window: you lose this computer's board and the one-click way back.
- `last_seen` for online: stale by up to a day.

## Weakest premise
Opening another computer from the laptop's browser needs that browser signed in to Kosmos+ and Allowed ONCE on each
computer, exactly like a phone. For Agent1s and Mortals that happens in milestone 1's session with Josh; until then
the first open of each shows the sign-in and Allow step. The switcher's job (list and open) does not depend on it.

## Order
Coordinator route (kosmos-relay) first, deployable on its own; then this repo. This repo's route answers
"not available yet" (the tunnel's own refusal) against an old connector or coordinator, and the section stays hidden.

## Review round 1 (fable): 1 BLOCKER, 4 WARNINGs, 2 CONVENTIONs, 3 NITs
- BLOCKER: the browser check was not in docs/browser-checks/gated.txt, so nothing ran it (tools.browser-checks-wired
  red). Enrolled, sorted; the wiring, PR-select and quarantine guards pass (56/56).
- W: any DNS name (a LAN address included) passed validation. Now one label under the coordinator's domain, as the
  native app's rule; enforced before any probe; an off-domain row is dropped and never probed (arm added).
- W: offline rows linked to a browser error page. Only online computers are links now; the plan's claim is corrected.
- W: a reopened menu showed the previous open's state words. The section is hidden and emptied at each read's start.
- W: two tests weaker than they read: the worldswOpen test grepped for the call (now runs the shipped function with
  a spy), and the probe-timeout arm hung instead of failing (now a hard race).
- CONVENTION: connect-only Macs and phones open another computer in-window (#4356): stated in the plan and markup.
- CONVENTION: the ship dependency (coordinator deploy + connector rebuild) is stated in Order and Weakest premise.
- NITs: New Kosmos's rounded bottom corners (square when the section follows), invented host names in the check
  fixture. DEFERRED: a short cache for fidgety menu opens (each open is one signed call plus N probes).
