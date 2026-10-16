# familye2e-6239: #6239 slice 2, seen working end to end (local, never production)

tools/family-e2e-6239.js runs a local debug coordinator and relay and two boards (P, a parent's computer; K, the
child's), reusing tools/fed-own-e2e.js's (#4693) helpers, and walks the family join as people do it: web sign-up,
board sign-in, P allows the parent's browser, operator org-create --kind family, the parent's join code from the
console, K's preview (family words, no company), a refused join without the words screen (the control), the join with
them, the board saying family, the coordinator's audit row, the spent code's neutral refusal, and the leave.

## Decided
- Local, not production: the #4693 harness already proves boards against a local coordinator, so no prod org, no
  second device and no operator step on the live box. Splinter was told (21:1x).
- A tool, not a test in the suite: it needs three relay debug binaries and runs minutes (as fed-own-e2e.js).

## Result (2026-10-15 23:0x CDT, relay main 416f8a05 built on the external SSD)
- VERDICT PASS, 21/21: the console refuses the parent's browser until P allows it (control), P allows it by the code
  its sign-up showed, org-create --kind family, the parent's join code, K's preview (family, family words, not joined),
  the refused join without the words screen (control), the join with it, K's board says family, the audit row
  ("words shown on the board's screen (the board's word)"), the spent code's neutral refusal, the leave.
- NEGATIVE CONTROL: the same run with org-create --kind company: 15/21, failing exactly the six family checks
  (kind, family words, the unseen-words refusal, the join, K's kind, the audit detail); its consent hash is the
  company's pinned 68fb6404...1151.
- Harness fixes on the way: org-create logs to stdout beside the id (parsed by line); the coordinator replaces the
  browser's offered device id (#5422), so P's row is found by the sign-up's match code; /api/org names the org only to
  the screen (#5531 review 12), so the GET carries the screen's headers.

## Found, not this branch's
- P's /api/remote/devices/allow answered {ok, acked, allowed: true} for a device id the coordinator does not hold
  (the browser's own offered id, replaced at sign-in). Nothing is granted to a real device, but the answer says one was.
