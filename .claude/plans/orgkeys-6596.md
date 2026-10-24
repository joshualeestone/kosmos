# orgkeys-6596: #6596 step 8, slice 1 (kosmos engine)

Card: joshualeestone/kosmos#6596 (security hardening O04-1, detail private). Steps 6 and 7 are kosmos-relay
(trust store, then registration learning + floor). This slice is the board side of the same trust rule.

## Goal
The board verifies a company policy bundle (engine/orgpolicy.js) against the SAME keys the connector trusts
(kosmos-relay crates/tunnel/src/trust.rs trusted_keys), not only the key pinned at setup. Without it, the first
service key rotation leaves the tunnel working and the board refusing every policy.

## Decisions
1. engine/kst1.js verify(token, keys, typ, now): `keys` is one pinned key (as today) or a list; any listed key
   that verifies the signature is enough. A list with no usable key gives the same "no pinned coordinator key".
2. New engine/trustkeys.js trustedKeys(stateDir, { recoveryKeys }) mirrors trust::trusted_keys:
   - no recovery key (shipped today): the pin alone (exactly today's behaviour);
   - no service-keys.json: the pin alone;
   - a store that verifies (servicekeys.verifyServiceKeySet over its `document` text and `signature`, held null,
     as read_store): that set's keys, and the pin only if the set lists it;
   - a store that is there and cannot be used (not text, not {document, signature} strings, a member named twice,
     does not verify): no key, with why (fault `unusable`);
   - a store that cannot be read (any error but ENOENT): no key (fault `unreadable`).
   Keys are returned in the pin's spelling (base64url of the raw 32 bytes) so kst1 reads them unchanged.
3. orgpolicy.refresh uses trustedKeys when no `pinned` is passed. A store fault is a local refusal
   (`local: true`, as "no pinned coordinator key" already is): nothing the company sent was refused.
4. The board's two wipes of the tunnel state folder (remote.js Forget, and the half-identity clear) keep
   service-keys.json, service-keys.floor and service-keys.lock. The tunnel's registration forgets the set itself
   (trust::forget_store) and writes the floor first; a board rm would drop the floor, so a forgotten set could be
   replayed. The names live once, in trustkeys.js.

## Rejected
- The board reading or writing the floor: the tunnel's business; the board only reads the store.
- Re-implementing the set check: engine/servicekeys.js already checks the relay's format against the relay's vectors.
- Wiping the store on Forget: loses the floor (above).

## Weakest premise
RECOVERY_KEYS (kosmos) and SERVICE_KEY_ROOTS (relay) are activated together with the same value. If only one is
set, board and tunnel disagree about which keys are trusted. Both files say so; activation is one paired change.

## Not in this slice
The accept-a-changed-key screen (the way through for the tunnel's PinMismatch). Next slice, before activation.

## Tests
engine/trustkeys-6596.test.js: each branch above, with a test recovery key and a signed store; orgpolicy picks up a
rotated key; the wipes keep the three names (and still remove everything else).
