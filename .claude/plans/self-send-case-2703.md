# self-send-case-2703 - self-send guard must match the router's recipient resolution

Card: kosmos#2703 (found by Sub-Zero dogfooding 0.6.54, confirmed on origin/main).

## Problem

`kosmos msg` refuses a note to yourself, but the refusal is decided by a
comparison that is stricter than the one delivery uses. The server-side guard in
`engine/messages.js` `send()` compared the recipient string to the sender's name
with an exact-string check (`toName === from`), while the router resolves
recipients case-insensitively: `chat.deliver` -> `chat.addressable` ->
`chat.resolveCard(roster, key)`, and `resolveCard` matches the exact sessionName
first and then falls back to a case-folded (`toLowerCase`) match.

Anything in that gap is a message the guard believes it stopped and the router
delivered. An agent named `subzero` sending to `SubZero` (or `SUBZERO`, or
`sUbZeRo`) missed the exact-string guard and was handed straight back to itself
by the router. The message's casing is normalised away before display, so it
arrives as `[message from your colleague subzero ...]`, indistinguishable from a
genuine colleague's message. The agent could then act on its own text as if a
peer had said it. Whitespace was already trimmed and caught; only case was not.

## Fix

Make the self-send guard ask the router's exact question - "does this recipient
resolve to me?" - by resolving `toName` through the same `chat.resolveCard` the
router uses, and refusing when it lands on the sender's own card
(`selfCard.sessionName === from`). The literal `toName === from` fast path is
kept for the common case and for a roster we cannot resolve against
(`resolveCard` returns null on a non-array/empty roster).

This deliberately reuses the router function rather than re-deriving a
case-fold, so guard and router cannot drift apart. Because `resolveCard` is
exact-first, a genuinely case-distinct agent (a real `SubZero` alongside
`subzero`) still resolves to its own card, whose sessionName is not the sender's,
so it is NOT over-refused. A naive `toName.toLowerCase() === from.toLowerCase()`
was rejected precisely because it would over-refuse that case.

## Files

- `engine/messages.js` - the guard in `send()`.
- `engine/messages.test.js` - two new tests.

## Tests

1. Every casing of your own name (`LEO`, `Leo`, `lEo`) is refused as a self-send
   with the same `/your own name/` wording. Arms: without the fix `'LEO' === 'leo'`
   is false, so the old guard would deliver.
2. A distinct case-variant agent (`subzero` -> `SubZero`) is NOT over-refused.
   The test first guards its own fixture (asserts the two case-distinct rows both
   survive a case-insensitive filesystem) so it cannot pass vacuously, then
   asserts the send is not refused as a self-send and that it actually PLACED.

Full node + shell suite green (`bash tools/run-tests.sh`, exit 0).

## Weakest premise

That the roster resolution `chat.resolveCard` uses is the same one delivery
uses. Verified by reading the call chain: `deliver` -> `addressable` ->
`resolveCard`, the identical function this guard now calls. If a future change
gives delivery a different resolver, this guard would need to follow it - which
is exactly why the guard calls the shared function rather than copying its rule.

## Not in scope

The cosmetic echo ("Placed into SUBZERO's session") that reflects the typed
casing rather than the canonical name (the card's "smaller, same probe"). It is
harmless on its own, is in the CLI not the server, and is not part of the card's
"Done when". For self-sends it is now moot - they are refused before any
"Placed" line. Left for a separate change if desired.
