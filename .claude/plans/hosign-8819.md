# hosign-8819: an admin's computer signs a hand-over start (kosmos#8819, for #8764)

## Finished means
An admin's Mac can sign a hand-over start through kosmos-relay's POST /v1/mac/org/handover/sign, and signs only the
hand-over the admin is shown: the company, hand-over id, leaving member, successor and agents in order, with the nonce
and generation the same answer gave. Anything else is refused before the Enclave is asked, and only what review()
returned can be signed, once.

## What changed
- engine/seadmin.js: the handover-start tag, encodeHandoverStart / decodeHandoverStart (as roster.rs
  encode_handover_start), the tag in SIGNED, and sign() returning { adminId, sig } for it.
- native-se/main.swift: the tag in kosmos-se's own list, with its Touch ID reason.
- engine/handoversign.js (new): review() and approveAndSend().
- engine/handoversign-8819.test.js: the vector (pinned on kosmos-relay too), the signed bytes verifying, every
  substitution refused with nothing posted, a hand-built prepared object refused, one review signing once.

## Rejected
- Trusting a prepared object's shape in approveAndSend (Mona Lisa's review 1 showed it signs anything prepared).
- Refusing duplicate agent names here: escrowd accepts them and the coordinator's start already drops repeats.

## Weakest premise
`from` and `to` are account ids; the names a screen shows for them come from the coordinator (#8764 premise 2). The
screen (#8710 slice 5) is not built, and nothing calls review() yet.

## Verify
engine/handoversign-8819 + seadmin-7116 + enrolsign-7116: 41/41. The comparison and the review guard each shown red
with the check removed.
