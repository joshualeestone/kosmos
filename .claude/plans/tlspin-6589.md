# tlspin-6589: the Mac app refuses another computer's certificate unless its key is the one that computer vouches for (kosmos#6589, S-7c, app half)

## Problem
The service can get a valid certificate for any of the person's computers' names, with a key of its own. When the
switcher opens another computer, the Mac app navigates to that name with a ticket in the URL fragment, and whatever
server completed TLS gets the page, so a script there would read the ticket. A browser would accept that certificate.

## Depends on
kosmos-relay#486 (the relay half). Each computer serves, at GET /_kosmos/tls-pin, a statement signed with the key its
pairing carries, naming the TLS key it serves. `kosmos-tunnel tls-pin --to <origin>` checks it against peers.json,
pins the origin to that peer, and answers pinned / none / required. Until a connector with that verb ships, this half
answers `none` (ordinary checking): nothing changes for anyone.

## Change
1. engine/remote.js `tlsPin(address, {fresh})`:
   - runs the verb, local only;
   - passes `pinned` only with well-formed 64-hex key hashes, `none` as none, and anything else as `required`;
   - caches a definite answer 5 minutes (`fresh` skips it; `required` is never cached);
   - a connector without the verb, or a computer not signed up, answers `none`.
2. server.js `GET /api/remote/tls-pin?address=` for the app's own code, which has the board token and no page cookie.
   Refused unless the request is:
   - from a loopback peer;
   - not forwarded (Kosmos+ remote access forwards);
   - without an agent token;
   - with the board's token on a board that enforces one.

   The address must be one an account computer can have.
3. native-app/main.swift:
   - `webView(_:didReceive:completionHandler:)` judges only computers' addresses (isKosmosPlusURL, not the Kosmos+
     site), on 443;
   - ordinary trust evaluation first (a failure cancels);
   - then it hashes the leaf's key (P-256 SPKI SHA-256, as the computer hashes it) and asks the board;
   - `tlsPinDecision`: pinned with a match allows; pinned without one, or required, asks once more with `fresh`
     (a renewal past the cache) and then refuses; none, or no board answer, is ordinary checking. A ticket is made
     only by this computer's board, so with no board answering, no ticket is at risk;
   - a refusal cancels the challenge and says so (an alert at most once a minute per computer; always logged).
4. Tests:
   - engine/remote.tlspin-6589.test.js (4);
   - a server route test;
   - native-app.tlspin-6589.test.js (the wiring);
   - 12 new --kosmos-app-mode-selftest rows (the hash against an openssl P-256 vector; the decision table). The
     row-count pins in two native tests move from 191 to 203.

## Decisions
- No board answer means ordinary checking, not refusal. A connect-only Mac (no board) could otherwise open no
  computer. And there is no ticket to protect, since only this computer's board makes one.
- A board route rather than the app running the connector itself: the board already runs the connector with the
  right state dir and caches; the app reads board.token already.
- Retry once with `fresh` before refusing (Ice Cream Kitty's review): a renewal must not read as an attack.

## Not covered, by design
- A plain browser (a phone, or a browser on a Mac) has no challenge handler. This protects the Mac app only.
  Moving the ticket out of the fragment behind a pinned preflight is the follow-up.
- Whether WebKit calls the handler for EVERY connection (a resumed TLS session, an HTTP/2 coalesced one) is measured
  on the real, signed app, not here: point an address at a wrong pin and check a first AND a second navigation in
  one session are refused. Until that is measured, this is a defence for new connections.
- Non-P-256 certificate keys hash to nothing, so they are refused when a pin exists. Every computer's key is P-256
  (rcgen's default).

## Weakest premise
That WebKit consults the challenge handler before any page script on that host runs. The handler decides the TLS
connection itself, so a cancelled challenge loads nothing, but that has to be seen in the real app.
