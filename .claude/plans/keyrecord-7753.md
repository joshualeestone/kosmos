# keyrecord-7753: the member's Mac signs its backup key record (kosmos#7753, Mac side)

Finished means (this branch, the Mac side only): every company member-key registration this computer sends (ensureMemberKey) carries `member_key_sig`, an Ed25519 signature by its device key (the connector's mac_key) over the record bytes on #7753, so escrowd can later check a release's key against the member's enrolled device keys. A computer whose device key cannot be read, or that cannot sign with it, registers exactly as before, with no signature. A personal backup's key (personalbackupkey.js, the same route) is left unsigned on purpose: it has no escrow release to protect. escrowd's check and the coordinator storing the field are not here: escrowd is #5686 Part 2's (Renet Tilley), and the coordinator's live path changes only through Kitty.

Measured, both arms:
- engine/backupmemberkey-7753.test.js: the signature verifies over the true record, and fails for another device, org, member, epoch or planted key. With the code changed on purpose to sign epoch + 1, 2 of its 4 tests fail. The bytes match a vector built by hand from the card's layout, not from the code.
- engine/backupmemberkey-5744.test.js green (38), now pointed at an empty device-key folder in its sandbox so it never reads a real key.
- The default wiring (no deviceKey option) signs with the connector's mac_key from the data root's own state folder, laid out as the connector writes it. Red when the require path is broken on purpose; the public-key case is red when the sign is moved out of its try.

Decided (the open questions, written on #7753):
- Check at release only, for now. The live coordinator's MemberKeyReq has no deny_unknown_fields, so it ignores the new field: no live behaviour changes. Rejected: checking at upload first, which changes the live path while the Cloud sale is live.
- An epoch with no signed record falls back to the first-seen pin, with the reviewer told. Rejected: refusing, which would strand every existing epoch.
- A device key revoked later counts if it was enrolled when escrowd first pinned the epoch (escrowd's own clock).
- The record does not bind the `wrap`: escrowd opens the wrap and requires it to open to the pinned member_public (kosmos-relay coordinator/src/escrowcore.rs, open_member_wrap with member_public), so a swapped wrap fails there, not here.
- A registration that went out unsigned says so in ensureMemberKey's answer (`unsignedBecause`, one fixed sentence per cause), the early warning for escrowd's ratchet (agreed with Renet: her refusal names this cause first).
- The remaining work (coordinator storing the field, the re-send, escrowd's ratchet and cutover) stays on #7753, which stays open until a release has checked a real record.
- No verifier is exported here: the check belongs to escrowd, and engine.reachable refuses a test-only export.
Not done here, and needed before the signature protects anything (on #7753):
- The coordinator must store `member_key_sig` and serve it to escrowd. Until then it drops the field.
- A registered epoch is never sent again (ensureNow answers it from disk), so every epoch registered before the coordinator stores the field has no stored signature. The fix belongs with the coordinator change: the coordinator echoes the field when it keeps it, and the Mac re-sends a registered epoch, once, when its answer did not echo it. Not built now, because today every call would repeat a POST to the live route.
- A breached coordinator can strip the field and plant its own key. escrowd needs a cutover rule: an epoch first pinned after the coordinator stores the field must carry a valid signature, or the release is refused. Without that the signature only adds a warning.
Agreed with Renet Tilley (escrowd, 2026-11-01 17:56): the format stands, and this repo owns it. The shared vector (seed, device public key, bytes, signature) is in engine/backupmemberkey-7753.test.js, and the Rust verifier carries the same values. escrowd treats a record signed by a `backfill: true` device key as unsigned, because those keys are unauthenticated copies, and it refuses an epoch that does not fit a u32. Both are escrowd's.
Weakest premise: that deviceKey() reads the key Kosmos+ has enrolled. backupdevicekey.js says a read mid-registration can be the new identity's key. A record signed then verifies only once that registration finishes, and because a registered epoch is not re-sent, it stays that way until the re-send above exists. Reasoned, not measured.
What would change this: Renet choosing a different byte format for escrowd, which changes only memberKeyRecordBytes and its vector.
