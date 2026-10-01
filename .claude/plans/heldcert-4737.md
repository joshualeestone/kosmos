# heldcert-4737 (app half): a computer waiting to be allowed is set up, and is never retired

Card: kosmos#4737. Relay half: kosmos-relay branch `heldcert-4737` (f211851f, held).

## What the person sees
A second computer signs in to Kosmos+ while it waits for the older computer's Allow. Today it would be
issued a certificate for its name at once (the card's exposure). Once the tunnel registers a waiting
computer WITHOUT a certificate, the app must still treat it as set up: start its tunnel, show #4640's
"waiting to be allowed" state, and never retire it. The certificate arrives the first time the tunnel
runs after the Allow.

## Why the app must change first
The app counts a state folder as set up only when it holds `tls.crt` and `tls.key` (`enrolled()`), and
its sign-in retry RETIRES a folder holding a key and id but no certificate (`halfRegistered()` ->
`clearHalfIdentity()`), because that is what a register cut off after the coordinator accepted it
looks like. A waiting registration looks exactly the same on disk. So with the relay half alone, a
waiting computer is never started and the next sign-in retires the very computer the owner is about to
allow (review 1 of the relay half, 2026-09-30).

## The marker
The tunnel will write `held` into the state folder as the LAST step of a held registration, remove it
FIRST at every register, and remove it once it fetches the certificate (relay half, follow-up commit).
So `held` present means: this identity was accepted and is waiting; its certificate comes later.

The app (this branch):
- `engine/enrolment.js` (new, pure): `ENROL_FILES`, `CERT_FILES`, `HELD_FILE`, `missingFor(exists)`,
  `enrolledBy(exists)`. With `held` present, the certificate files are not missing.
- `engine/remote.js`: `enrolled()` asks `enrolledBy`; `halfRegistered()` is false while `held` exists.
  `ENROL_FILES` re-exported from the module (the remote.test.js equality arm stays meaningful).
- `engine/remote-report.js`: the tunnel state and the `not-enrolled; missing:` list ask the same module,
  so a waiting computer is never reported as missing its certificate.
- Forget needs nothing: it removes the whole state folder.

## Order (the card's, kept)
1. This app half. Alone it is inert: nothing writes `held` yet.
2. The relay half writes `held` and registers a waiting computer without a certificate. It reaches
   people only in an app cut, which by then carries step 1. The tunnel's first certificate fetch backs
   off (each retry is an ACME order).
3. The coordinator refuses `POST /v1/mac/cert` for a waiting computer, once apps with 1 and 2 are out.

## Tests (each with a control that can go red)
- enrolment.test.js: held + id + address = set up; the same without `held` = not set up (control);
  `held` without an address = not set up (the marker never stands in for the identity).
- remote.test.js: `enrolled()` true with `held`; a sign-in under another name retires nothing with `held` and
  retires the same folder without it (control). CORRECTED after review 2: those arms have the address, so
  `enrolled()` decides and `halfRegistered()`'s held clause is never read; the clause has its own arms (held, no
  address file: not retired; the same without `held`: retired).
- remote-report.test.js: a waiting folder reports no missing files and is not `not-enrolled`; the same
  folder without `held` still says `missing: tls.crt, tls.key` (control).

## Decided
- The marker is a file the tunnel writes, not a flag the app keeps: the tunnel is what knows the answer
  said `held`, and a file survives an app restart and an install over the top, like the rest of the
  identity. Rejected: inferring "waiting" from the ticket refusal alone. Before the first ticket ask
  there is no refusal, and that is exactly the window in which the retire happens.
- Rejected: dropping the certificate files from `ENROL_FILES`. That would stop the app telling a cut-off
  register from a set-up computer, which is what the retire depends on.

## Weakest premise
That a computer the other computer DENIES needs nothing here. It keeps `held` and stays "set up";
#4640 shows the final refusal, and Forget (retire and wipe) is how the person starts over. If the
coordinator's final refusal should clear the folder by itself, that is a follow-up, not this branch.

## Review 2 (blind, both halves): CONVERGED, 4 NITs, all taken
- N1: an in-flight first fetch racing a rename can leave the old name's certificate; same fix as #4876, added there.
- N2: halfRegistered()'s held clause had no test that could fail; arms added (above). The plan overstated it.
- N3 (relay): the "no certificate yet" sentence is a const with a literal test, as HELD_FILE.
- N4 (relay): the mark is removed right after tls.crt is written, not after ca.crt.
