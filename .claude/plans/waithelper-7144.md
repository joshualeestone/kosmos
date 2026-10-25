# waithelper-7144: one helper for "waiting to be let in"

Card kosmos#7144, a follow-up to #7129 (review 5 of its loop).

## Decided
- `waitingToBeLetIn(sealed, link)` in engine/fedseats.js is the ONE statement of `pendingClear(sealed) || (sealed === null && waitingLink(link))`.
- handleEvent reads the link once (`sealedLink`) and computes `waiting` once. Both the no-downgrade exemption (`sealedRoom && !waiting`) and the #7129 mark (`unverified = waiting`) read it, so the set shown while waiting is the set marked by construction.
- sendPost's hold calls the helper.
- No behaviour change: the existing slice 2 and #7129 tests pass unchanged. One new test pins that no copy of the expression remains outside the helper, and that each site reads it.

## Not changed
`if (!opened && pendingClear(sealed))`, the sealed-envelope note, asks a narrower question (a keyless record only) on purpose. It stays as it is.
