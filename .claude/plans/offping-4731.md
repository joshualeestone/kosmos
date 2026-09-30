# offping-4731: a computer with remote access off is still heard from (kosmos#4731)

## Problem
The coordinator decides whether a computer is "in use" from its last signed request. engine/mac-standing.js
returned early when the remote-access switch was off, so an enrolled computer with remote access off sent nothing,
and since #4681 a computer quiet for a day opens three lost-computer recovery doors (retire by an unapproved sign-in,
setup taking its name, a waiting computer resetting the second step).

## Call
- mac-standing.js: an enrolled computer sends the standing request with remote access OFF too, with an EMPTY body (no
  #4277 remote report). Still signed through the tunnel's `mac-request` verb; the existing /v1/mac/standing route.
- remote.js refreshStandingIfStale: with remote access off the cadence is OFF_STANDING_TTL_MS (12 h) whatever TTL the
  caller asks, so the 10-minute report timer and the page's minute TTL do not turn "off" into minute-scale contact.
  12 h sits well inside the coordinator's one-day quiet line.
- Unchanged: remote access ON (report body, minute cadence); not enrolled (nothing); an unreadable settings file
  (nothing, #4308).

## The product call the card left open, decided (reversible)
Does a person who turned remote access off expect the app to contact the coordinator at all? Decided YES while they
are still signed in to Kosmos+: the request carries only the computer's own signature, twice a day, and it is what
stops "remote access off" reading to the coordinator as "this computer is lost", which is what protects that person
from the recovery doors. Signing out stops it. If Josh wants "off" to mean silence, the revert is the gate in
fetchStanding, and then #4681's doors need another signal.

## Reversed on purpose
mac-standing.js said "a PAID route must not be called when the feature is off" (fed-gate W1, #3355): an engineering
choice to spare the coordinator, not a ruling. Kept in spirit: twice a day, empty body.

## Weakest premise
That the coordinator counts /v1/mac/standing as "in use" for #4681's quiet test. The card says standing counts; not
re-read here in kosmos-relay.

## Tests
engine/mac-standing.test.js (off: one signed call, empty body; CONTROL on: the report body),
engine/remote-standing-refresh.test.js (off: asked after 12 h, not inside it even with TTL 0; CONTROL on: minute
cadence unchanged; CONTROL not enrolled: never). engine/remote-unreadable-4308.test.js still holds (an unreadable file
sends nothing; this change first broke it, fixed by gating on a readable file).
