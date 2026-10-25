# waithelper-7144: one helper for "waiting to be let in"

Card kosmos#7144, a follow-up to #7129 (review 5 of its loop).

## Decided
- `waitingToBeLetIn(sealed, link)` in engine/fedseats.js is the ONE statement of `pendingClear(sealed) || (sealed === null && waitingLink(link))`.
- handleEvent reads the link once (`sealedLink`) and computes `waiting` once. Both the no-downgrade exemption (`sealedRoom && !waiting`) and the #7129 mark (`unverified = waiting`) read it, so the set shown while waiting is the set marked by construction.
- sendPost's hold calls the helper.
- No behaviour change: the existing slice 2 and #7129 tests pass unchanged. One new test pins that no copy of the expression remains outside the helper, and that each site reads it.

## Not changed
`if (!opened && pendingClear(sealed))`, the sealed-envelope note, asks a narrower question (a keyless record only) on purpose. It stays as it is.

## A neighbour, not a copy (review 3)
engine/federation.js `ownCodeRefusal` has its own "waiting" test (`link.pendingClear === true || st.pendingClear === true`). It asks something different: whether this computer may make a code. It deliberately also refuses a half-written adoption. It is left alone here. If the two ever need to agree, that is a change of its own.

## The pin's limit (review 3)
The test counts calls to waitingLink, so any copy that calls it reds. A copy that writes out waitingLink's own body would not add a call. The three site pins cover the known sites.
