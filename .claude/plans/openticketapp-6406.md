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
  (8 s cut). One at a time (a click while one is out is ignored). The navigation goes through a throwaway
  noreferrer link (computersGo), so this board's address is not sent as Referer (review 4).
- server.js `POST /api/remote/open-ticket`: refused (403) unless the request was made on this computer's own screen:
  isViaScreen (no agent token, a browser's header) AND madeOnThisComputer (review 4: loopback Host AND loopback
  Origin AND no forwarding header; Kosmos+ sets x-forwarded-for on everything and x-forwarded-host on all but a
  webhook, pinned by a test in the relay's openticket-6406 branch). A reverse proxy of the person's own fails the
  Origin half even if it adds no header or rewrites Host. So a phone let in to this computer cannot use this computer's key to reach the others. The address must be one an account's computer can have
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

- A local process sending a browser's header (no agent token) can get a ticket, as it can use the other screen-only
  routes. Accepted: such a process runs as the person and can run the tunnel with this computer's key itself.
- The ticket stays in that window's history entry for its fragment until the gate page takes it out (replaceState,
  first thing it does); it is single use and good for two minutes either way.
- The page gives up on the ticket after 8 s and opens the plain address; the tunnel call may still finish and make a
  ticket nobody uses (it expires).

- Windows, a computer whose mode is not chosen yet (review 2): the app sends every other address to the person's own
  browser, so the other computer opens there WITH the ticket (and a failed hand-off shows the address in a box). It
  is the person at this computer, the ticket is single use and good for two minutes, and the gate takes it out of the
  address first thing. Accepted rather than asking the window its mode.
- The click is now a script navigation, not a link click. Both apps keep a Kosmos+ address (the person's computers)
  in the window either way (Mac isKosmosPlusURL; Windows ConnectLinkDecision's IsKosmosPlusAddress, once a mode is
  chosen). With a coordinator the app does not count as Kosmos+ (a staging override) it is refused instead of opened
  in the browser, and the Mac's log line names the address with the ticket. Development setups only.
- While the ticket is made the link reads busy (aria-busy, a progress cursor); after 8 s the plain address opens
  whatever the request does.

## Steps
1. engine openTicket + engine/remote.openticket-6406.test.js.
2. server route + server.test.js (every refusal, a control that reaches the engine).
3. page: computersLinkTarget mark, computersOpenClick; web.computers-switcher-4648.test.js (ticket, failures,
   browser and modified clicks, the mark).

## Review log
- 1 sonnet: the screen-only wording says what it guards (no agent token, not relayed) and the local-process limit;
  the relay header premise pinned in the relay branch's test; the history-entry and timeout limits stated.
- 2 opus: the link says it is busy; a hard 8 s fallback (no AbortController needed); the webhook path's header stated
  and its case tested; one at a time tested against the page's own declaration; the unchosen-Windows and
  script-navigation limits stated.
- 3 sonnet: the 8 s fallback tested (a request that never answers: one plain navigation, busy cleared, a late
  answer ignored). Not taken: a spoken busy state (the wait is short and ends in a navigation either way).
- 4 opus: no Referer to the other computer (a throwaway noreferrer link; the browser check asserts the navigating
  link's rel); "on this computer" is positive (madeOnThisComputer: loopback Host and Origin, nothing forwarded; a
  person's own reverse proxy fails it; unit arms for each); the busy style keeps contrast; wording.
- 5 sonnet: the route also requires the socket to be this computer's (isLoopbackPeer); the noreferrer link path is
  unit-tested with a page (it was only reached by the browser check).
