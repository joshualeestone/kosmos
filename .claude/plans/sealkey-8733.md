# kosmos#8733 board half: the hand-over key tied to the successor's computer

Relay half: kosmos-relay branch `handoverseal-8733` (/key checks `sig` against the calling computer's key; /mine relays
seal_sig, seal_signer, seal_member, seal_history and sender_member, sender_history). This is the board.

## Done
- `engine/handoverseal.js`: signSeal (the successor's device key over tag, id, one-time key, u32-BE length-prefixed;
  pinned against kosmos-relay handover.rs's vector), checkSeal (leaving computer), checkSender (receiving computer),
  both against escrowd's signed device-key history (devkeyhist.verify, escrowd's shipped key only).
- handoverrecv: the key step signs with backupdevicekey.deviceKey, or sends nothing. Opens only on checkSender.
- handoversend: packs only on checkSeal.

## Decided
- Each refusal is wait or final. Wait (nothing packed or opened; bounded): escrowd not reachable (null history), a
  history too old or dated ahead, a signer escrowd does not list yet, a key enrolled a moment after this clock. Final:
  a bad signature, another member or company, a history escrowd did not sign, a revoked key, a BACKFILL entry (escrowd
  enrols a key once, so a backfilled key never becomes admin-enrolled: kosmos#8768).
- The signature is checked before the history, so a forged one is final even while escrowd cannot be asked.
- Sender: check waits counted in tieSoft (on disk), MAX_TIE_SOFT = a day, reset whenever the check passes (tieOk), apart
  from the network run (soft, MAX_SOFT). Receiver: its own clock (waitSince), OUTAGE_LIMIT_MS, cleared on a pass.
- checkSender runs at now until kosmos#8764 gives a signed pack time: stricter except for a key enrolled after the pack
  (needs two admins; listed on #8764).
- Rejected: accepting a backfill entry (the coordinator's word); waiting on it (it can never pass).

## Open (filed)
- kosmos#8764 (Angel): the successor's member id and the pack time still come from the coordinator.
- kosmos#8768 (Mona Lisa): a carried-over computer cannot become admin-enrolled, so it cannot hand over or receive.
- Not covered by a dedicated test: the sender's tie-wait backoff and the changed-part reset of tieSoft (both bounded by
  other counts); a board that restarts often spends its tie count sooner (retryAt is not kept).
