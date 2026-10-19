# joinid-6315: a second computer's Allow request reaches the first computer's screen

Card: #6315. Owner: Angel.

## Done means
On a board fed the coordinator's real joining-computer row (`device_id = computer:<32 hex>`), the request is listed with
its computer name and code, and Allow hands that exact id to the tunnel. A malformed `computer:` id is still refused.
Measured end to end only once a real first computer runs a build carrying it.

## Cause (measured 2026-10-16)
The coordinator serves the row (its pending query, run on the live database, returns it); the tunnel passes it
through; `engine/remote.js` dropped it because `DEVICE_ID` does not allow a colon. Tests only used ids like `dev-a`.

## Steps
1. [x] `REQUEST_ID` = `DEVICE_ID` or `computer:[0-9a-f]{32}`, used for the pending list (`pendingDevices`), the
   allowed list (`devicesList`), and the Allow / Not me / Remove validator (`checkId`).
2. [x] Kept `DEVICE_ID` for this computer's own ids and for `vouchRows` (a vouch must never allow a computer) and
   `recentlyVouched` (browsers only).
3. [x] Tests in `engine/remote.joincode-4794.test.js` on the REAL id: listed with name and code; uppercase, short and
   path-shaped computer ids dropped; a k1 phone control still listed; Allow sends the minted id and code to the
   tunnel; a malformed computer id is refused. Both new tests fail with the old rule (measured).
4. [x] Audit of the board's other checks on coordinator-fed fields (error codes, account addresses, computer names,
   join codes): each matches the coordinator's real format.

## Decided, not missed
- Lowercase hex only, 32 characters: the coordinator makes a computer id with `util::new_id()` (hex of 16 random
  bytes), and the live row measured today has that shape.
- Weakest premise: that the page needs no change. It carries the id in attributes only, so a colon is safe there; a
  browser check on a joining row would prove it on screen.
