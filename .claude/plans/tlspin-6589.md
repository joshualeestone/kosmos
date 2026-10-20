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
   - caches a definite answer 5 minutes (`fresh` skips it; `required` is never cached); parallel asks for one
     address share one run; a sign-out or a removed device forgets the cache;
   - keeps at most 4 key hashes from an answer (the relay sends one);
   - `warmTlsPins`: whenever the board reads the account's computer list, it asks about each OTHER computer in the
     background (at most 10), so a first switch finds the address already pinned;
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
   - ordinary trust is evaluated on a background queue (SecTrustEvaluateAsyncWithError), then the pin half and every
     call to the completion handler run on the main thread; a trailing-dot spelling of a name is judged too; the
     selector is pinned with @objc; the async evaluation is called from its own queue (review 3), and the self-test
     runs it on a real certificate;
   - a refusal says WHY in two wordings: a key that does not match ("pair it again if you set it up again"), or a
     check that could not run ("try again in a moment"), so a board hiccup never tells the person to re-pair;
   - `tlsPinDecision`: pinned with a match allows; pinned without one, or required, asks once more with `fresh`
     (a renewal past the cache) and then refuses; none is ordinary checking;
   - NO board at all (no port: a connect-only Mac) is ordinary checking. A board
     that is there but answers badly (a 403, a restart, a timeout) is `required` and logged: the ticket may already
     be in flight (review 1);
   - a refusal cancels the challenge and says so (an alert at most once a minute per computer; always logged).
4. Tests:
   - engine/remote.tlspin-6589.test.js (4);
   - a server route test;
   - native-app.tlspin-6589.test.js (the wiring);
   - 14 new --kosmos-app-mode-selftest rows (the hash against an openssl P-256 vector; the decision table; a real self-signed certificate through tlsLeafKeyHash and evaluateTrustOffMain). The
     row-count pins in two native tests move from 191 to 205.

## Decisions
- NO board means ordinary checking: a connect-only Mac could otherwise open no computer at all. A board that fails an
  exchange means refusal (after one fresh retry): a failure must never turn a pin off.
- A forget (sign-out, removed device) bumps a generation, so an ask already running when it lands keeps nothing.
- Warming leaves a computer that answered required alone for a minute (the app's own ask is never held back).
- A board route rather than the app running the connector itself: the board already runs the connector with the
  right state dir and caches; the app reads board.token already.
- Retry once with `fresh` before refusing (Ice Cream Kitty's review): a renewal must not read as an attack.

## Not covered, by design
- KOSMOS_URL set (the developer path) leaves no resolvedPort, so it also falls back to ordinary checking; that is a
  developer setting, not a connect-only Mac.
- A CONNECT-ONLY Mac (no board of its own; review 2). Its window shows another computer's board, which can make a
  ticket and open a third computer. That navigation is not pinned: this Mac has no board to ask, and the page's board
  cannot be asked with this Mac's token. Closing it needs a pin source on the connect-only Mac itself (it would run
  the connector's check directly), a follow-up. Stated, not claimed safe.
- A plain browser (a phone, or a browser on a Mac) has no challenge handler. This protects the Mac app only.
  Moving the ticket out of the fragment behind a pinned preflight is the follow-up.
- First contact: an address is pinned only once a statement from it verifies. Whoever re-routes a name can answer the
  very first ask from this Mac with a 404, which reads `none` (ordinary checking). Warming the pins whenever the
  computer list is read narrows that to before the first list read on this Mac; recording the address at pairing
  (a pairing protocol change, kosmos-relay follow-up) would close it.
- Whether WebKit calls the handler for EVERY connection (a resumed TLS session, an HTTP/2 coalesced one) is measured
  on the real, signed app, not here: point an address at a wrong pin and check a first AND a second navigation in
  one session are refused. Also open the Kosmos+ site in the app FIRST, then switch to a wrongly pinned computer: the site
is run by the party in the threat model, the handler skips it on purpose, and an HTTP/2 connection to it is the likely
one a computer's request could be coalesced onto. Until that is measured, this is a defence for new connections.
- Non-P-256 certificate keys hash to nothing, so they are refused when a pin exists. Every computer's key is P-256
  (rcgen's default).

- On a board that enforces no token (a sandboxed test board), any loopback caller can make it ask about an account
  address and pin it. It only ever pins to the computer the person paired, so it is cheap, not a hole.

## Weakest premise
NOT YET RUN IN THE REAL APP. Review 3 found that the first version of the handler would have crashed the app on the
first switch (SecTrustEvaluateAsyncWithError called from main with another queue traps), and no source-text test could
see it. That call is now driven by the self-test with a real certificate (a misuse fails the bundle build), but the
handler as a whole has never run in a real window. Until the real-app check below is done, read this as built and
unit-tested, not as working.

That WebKit consults the challenge handler before any page script on that host runs. The handler decides the TLS
connection itself, so a cancelled challenge loads nothing, but that has to be seen in the real app.
