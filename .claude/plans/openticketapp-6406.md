# openticketapp-6406: open another of your computers in the app with no sign-in (the app half)

Card: joshualeestone/kosmos#6406 step 2 (Josh 11:31 / 11:32 / 12:04; design agreed on the card, Splinter 12:17). The
tunnel half is kosmos-relay branch openticket-6406 (`open-ticket`, `POST /_kosmos/ticket`, the gate page's `#kpt=`).
This ships with or after that tunnel: until then `open-ticket` is an unknown subcommand, the route answers 400, and
the page opens the plain address, which is today's behaviour.

## Finished looks like
In the Kosmos app, a plain click on any link to another of the person's computers (the switcher, the phone menu's
copy of it, the Agents view's cards and Open links) asks THIS computer for a ticket and opens the other computer at
`https://<address><path>#kpt=<ticket>` in the same window. That computer lets it in with no sign-in when it trusts
this computer's key; otherwise it shows today's sign-in. A browser, a modified click, or any failure here opens the
plain address as before.

## How it works
- web/index.html: computersLinkTarget marks every such link (`data-computer-open`, an attribute so a copied row keeps
  it); one document click listener (computersOpenClick) takes a plain left click on a marked https link in the app,
  POSTs `/api/remote/open-ticket {address}`, and goes to the address with the ticket, or without it on any failure
  (8 s cut). One at a time.
- server.js `POST /api/remote/open-ticket`: refused (403) unless the request was made on this computer's own screen:
  isViaScreen (a person's page, no agent token) AND not through Kosmos+ (the tunnel sets x-forwarded-host and
  x-forwarded-for on everything it forwards, replacing whatever a visitor sent). So a phone let in to this computer
  cannot use this computer's key to reach the others. The address must be one an account's computer can have
  (account-computers validAddress under the coordinator's domain).
- engine/remote.js openTicket: `open-ticket --state-dir --to https://<address>`, local only; only a base64url ticket
  is handed back.

## Calls (decided, with the weakest premise)
- Every link to another computer, not only the switcher: Josh asked to reach the other computer in the app; the Agents
  view's links go to the same place.
- Getting back from the other computer is #6411 (the native way back). Its board, reached through Kosmos+, refuses to
  make tickets (the phone rule), so its switcher's link to this computer opens the plain address. Weakest premise:
  that the native way back lands before people switch back and forth a lot.
- A local page in a browser on this computer cannot get a ticket from another site: the board's cross-site guard
  refuses its POST and CORS keeps the answer from it. A same-origin page (the board itself, opened in a browser) can;
  that is the person at this computer.
- The address is not checked against the last list of the account's computers: the ticket is bound to the origin it
  names, so a ticket for an address that is not one of the computers opens nothing.

## Steps
1. engine openTicket + engine/remote.openticket-6406.test.js.
2. server route + server.test.js (every refusal, a control that reaches the engine).
3. page: computersLinkTarget mark, computersOpenClick; web.computers-switcher-4648.test.js (ticket, failures,
   browser and modified clicks, the mark).

## Review log
