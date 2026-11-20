# kosmos#8738: what #8710 slices 3 and 4 left open (handover-8710-s3/s4 review loops)

Branch handoverfix-8738, on kosmos main after #8775 (sealkey-8733) merged.

## Built
1. Three of the deferred sender items (engine/handoversend.js): a hand-over packs only a REGISTERED agent folder; a tick
   that throws backs off instead of retrying hot; the link rules loosen only under a test.
2. The sender's stop: a part the leaving computer gave up on is ended on Kosmos+ once, answered only by an accept or
   "already past this".

## Deferred (still on #8738)
Keeping the sealed manifest across tries, a pack index (or a coordinator-side reset of pack_bytes), yielding inside
folderBytes. The tidyOrphans item was closed as not applicable.

## Weakest premise
Hand-over stays off behind KOSMOS_ORG_HANDOVER until #8733 is served whole, so nothing here is reached by a person yet.
