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

## Built (04:1x CST 11-20), against the design above
- kosmos-relay handoverrecord-8764: new roster op `handover_start` (one admin, its own tag and nonce purpose), signed bytes
  = org, hand-over id, from, to, the AGENTS (count then names), generation, nonce. escrowd then signs a record (org, id,
  from, to, agents, issuedAt) with the device-key history's key under its own tag, so the Mac keeps ONE anchor
  (devkeyhist VERIFYING_KEY). Coordinator: POST /v1/mac/org/handover/sign ({id} -> bytes; {id, sig} -> relay, keep the
  record only if it names this hand-over); /mine passes `record` to both sides and `own_history` (the leaving member's own
  escrowd history) to the sender.
- kosmos (this branch): handoverseal.checkRecord (leaving Mac): verifies the record, this org/id, exactly these agents,
  age <= 30 days, and that `from` is THIS computer (its own device key valid now in escrowd's history for `from`); checkSeal
  then runs for record.to, never seal_member. handoverrecv: the leaving member is the record's `from`; the packing key is
  checked at the manifest's own signed takenAt, no earlier than the record's issuedAt, so a key revoked AFTER the pack
  opens it and one revoked before does not.
- Added beyond the card: the agents in the signature (a breached coordinator could otherwise widen the list an admin
  approved), and the from-is-me check (otherwise a record for another departing member could be replayed here).
- The record vector is computed independently with Node's crypto and pinned on both sides.

## Weakest premises (as built)
1. escrowd and the coordinator do not fall in one breach (as devkeyhist already assumes).
2. The admin signs over account ids; what name the admin's screen shows for an id comes from the coordinator. The same
   gap devkey-enrol has; a console screen (slice 5 of #8710, not built) must show escrowd-attested names to close it.
3. One admin, not two: starting a hand-over always needed one admin, and an admin can already remove members.
4. Replay: a record from an EARLIER hand-over of the same member (its own id, agents, successor) can be replayed within
   30 days; the worst it does is complete a hand-over an admin once approved.
5. (review 1) A pack's takenAt is the packing key's own claim: a stolen computer could date a pack before its own
   revocation. It then also needs a breached coordinator to name its key and grant its uploads. Closing it needs a pack
   time from outside the packing computer (a later card).
6. The receiver does not check that the record's `to` is itself (the pack is sealed to its own one-time key, which checkSeal
   tied to the successor's computer on the other side).
