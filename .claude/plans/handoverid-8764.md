# handoverid-8764: the hand-over's successor and its pack time from something the coordinator cannot rewrite (kosmos#8764)

Card: kosmos#8764, handed to Angel by Ice Cream Kitty (m4920, 16:24 CST 11-19). Follow-up from her #8733 review.
PARKED needs-event: build only after her relay branch handoverseal-8733 and kosmos branch sealkey-8733 merge.
Stay off engine/handoverrecv.js's key step (she wires signSeal at /key next).

## Finished means
1. The leaving computer seals the departing member's agents ONLY to a successor named by an escrowd-signed hand-over
   record (company, hand-over id, from, to, issuedAt), checked against the escrowd key Kosmos ships (the same anchor
   engine/devkeyhist.js uses). The coordinator relays the record and cannot alter it.
2. escrowd signs that record only after verifying an admin's signed hand-over start against its own admin roster,
   as it does for roster ops (coordinator/src/roster.rs: webauthn-p256 or se-p256).
3. checkSender's time is the leaving computer's own claim from its signed manifest, bounded by the device-key history;
   never a time from the coordinator. Documented on both sides.
4. A test where the coordinator names a different enrolled member (with that member's real signed key and history)
   and nothing is sealed; its control (the escrowd-named successor) seals.

## Design (decided; weakest premise below)
- Chosen: admin signs the START (new roster action tag, e.g. "handover-start": org, hand-over id, from, to); escrowd
  verifies it against the admin roster and signs a HAND-OVER RECORD with its escrow key; the leaving Mac verifies only
  escrowd's signature (one anchor it already trusts), not the admin's passkey.
- Rejected: the leaving Mac verifying the admin's passkey itself. It would need a trusted copy of the admin roster
  (escrowd's signed roster head and its freshness rules), a second trust path for one check. escrowd already holds
  the roster; letting it attest keeps the Mac on one anchor.
- Rejected as the only control: the leaving member confirming the successor by name on their board. Weaker (a person
  compares names); may still be shown as a second check, stated as such.
- Freshness: the record carries escrowd's issuedAt, and the Mac refuses one older than a bound (as devkeyhist's head),
  so an old hand-over record cannot be replayed for a new hand-over; the hand-over id ties it to this one.

## Where
- kosmos-relay: coordinator/src/handover.rs (start, /mine carries the record), escrowd (verify the admin start, sign
  the record), console-bundle roster-bytes.js + vectors for the new tag.
- kosmos: engine/handoverseal.js (checkSeal takes the record), engine/handoversend.js; engine/seadmin.js SIGNED list
  and native-se's tag list if a Mac admin can start a hand-over.

## Weakest premise
That escrowd is independent enough of the coordinator to be the second party: if one breach takes both, this adds
nothing. The card's threat is a breached COORDINATOR; escrowd runs separately with its own key (devkeyhist relies on
the same premise). Second: whether an admin start should also need the departing member's own consent is a product
question, recorded, not decided here.
