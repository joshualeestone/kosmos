# kosmos#8710 slice 4: the successor's computer receives a hand-over

Parent plan: `.claude/plans/handover-8710.md` on branch `handover-8710`. Slice 3 (the packer, `engine/handoversend.js`)
is branch `handover-8710-s3`; this branch is stacked on it. Decisions on #8710 comments 7013598900, 7013606408,
7013613339 (11-19).

## What it does
`engine/handoverrecv.js`, on the same tick and the same switch as the sender (`KOSMOS_ORG_HANDOVER=1`, `mayReport`):
for each `/v1/mac/org/handover/mine` row with `side: 'receive'`:

1. `requested`: make a one-time key pair (`hpke.hpkeKeyPair`), WRITE ITS SECRET HALF TO DISK FIRST
   (`<store.ROOT>/handover/<id>.key.json`, mode 600, written whole), then `POST /key {id, pubkey}`. `/key` is good once
   (`requested` -> `packing`), so a lost secret after a sent key can never open the pack.
   A row still `requested` with a key on disk: send the SAME public half again (a lost answer).
2. `packing`: wait. If `seal_pub` is not our key's public half, this computer cannot open the pack: say so, final.
3. `packed` or `receiving` with `manifest` and `sender_pubkey`:
   - `sender_pubkey` null: the packing computer was retired; refuse (`done {ok:false}`), never skip the check.
   - read the manifest through `/read {id, keys:[manifest.key]}`; its bytes must hash to the record's sha256
     (base64) and size; open it with `backupformat.openManifest(sk, senderPub, handoverContext(org, id), body)`.
     A manifest that is missing (the slice 3 obligation: `packed` before its upload landed) or does not open:
     `done {ok:false}`.
   - restore into a Kosmos made by `restoreworld.prepareRestoreWorld` with a hand-over name ("Handed over: <member>,
     <date>"), through `restoresink`, with `backuprestore.restoreSnapshot` (memberSk = the one-time secret,
     devicePubAtSnapshot = sender_pubkey), then `finishRestoreWorld`. Agents arrive STOPPED and are enabled on the
     existing restore review screen (#5536 4c). Nothing here starts an agent.
   - `done {id, ok:true}`; then delete the one-time key file.
4. Chunks are fetched by a small fetcher over `/read` (at most 200 keys a call, MAX_READ_KEYS): https only, never a bare
   IP or localhost, the URL path ends in its key, no redirects, a byte cap per object; every byte is then checked
   against the device-signed manifest by `restoreSnapshot`. Not `restorefetch.readGrantFetcher`: its grant contract
   needs a numeric key epoch and a period, which a hand-over does not have, and faking them would be a fork in disguise.

## Not here
- #8733: the one-time key and `sender_pubkey` both come from the coordinator unauthenticated (residual named in the
  module header, as in slice 3). Hand-over stays off until it is closed.
- Profiles: no longer in the pack (slice 3 round 7); formerly `profiles/<seg>/<name>.json`; the restore world gets files only, as a restore does. The
  review screen reads the agent from its folder (its brief). Whether the profile file is used to recover the model and
  provider is decided after reading `listRestoredAgents`' enable path.
- The leaving computer archiving its copies after done (plan step 4's second half): its own piece, sender side.

## Tests (planned)
- key written before /key; /key not sent when the write fails; a resend after a lost answer uses the same public half.
- a foreign seal_pub, a null sender_pubkey, a missing manifest, a hash mismatch: each refused, `done {ok:false}` once.
- end to end: slice 3's packer output (the same fake bucket as `backupsnapshot-handover-8710.test.js`) received into a
  prepared world; the files match; the key file is gone after done.
- the fetcher's URL rules, each with its control.

## Layout fix found while designing this slice (11-19 09:3x CST), carried into slice 3's round 2
`restoreworld.finishRestoreWorld` moves only the `workers` and `projects` roots into the new Kosmos (MOVED), and
`listRestoredAgents` reads agents from that Kosmos's workers folder. Slice 3 named each agent's root `agents/<seg>`, so
a received pack would have left every agent in the restore folder, never listed. Slice 3 now names it `workers/<seg>`
(checked: `rootNameProblem('workers/ledger')` is null; 50 agents a hand-over, under the snapshot's 64 required roots).
`sessions/<seg>/...` stay in the restore folder, as a backup's transcripts do after a restore. (Slice 3 no longer packs
`profiles/<seg>` at all: a profile holds the install id, kosmos#5995; the receiver names agents from folder and brief.)
