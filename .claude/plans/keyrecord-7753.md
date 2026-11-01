# keyrecord-7753: the member's Mac signs its backup key record (kosmos#7753, Mac side)

Finished means (this branch, the Mac side only): every member-key registration this computer sends carries `member_key_sig`, an Ed25519 signature by its device key (the connector's mac_key) over the record bytes on #7753, so escrowd can later check a release's key against the member's enrolled device keys. A computer whose device key cannot be read registers exactly as before, with no signature. escrowd's check and the coordinator storing the field are not here: escrowd is #5686 Part 2's (Renet Tilley), and the coordinator's live path changes only through Kitty.

Measured, both arms:
- engine/backupmemberkey-7753.test.js: the signature verifies over the true record, and fails for another device, org, member, epoch or planted key. With the code changed on purpose to sign epoch + 1, 2 of its 4 tests fail. The bytes match a vector built by hand from the card's layout, not from the code.
- engine/backupmemberkey-5744.test.js unchanged and green (38). Under its sandbox the device key reads as missing, so its bodies carry no signature.

Decided (the open questions, written on #7753):
- Check at release only, for now. The live coordinator's MemberKeyReq has no deny_unknown_fields, so it ignores the new field: no live behaviour changes. Rejected: checking at upload first, which changes the live path while the Cloud sale is live.
- An epoch with no signed record falls back to the first-seen pin, with the reviewer told. Rejected: refusing, which would strand every existing epoch.
- A device key revoked later counts if it was enrolled when escrowd first pinned the epoch (escrowd's own clock).
- No verifier is exported here: the check belongs to escrowd, and engine.reachable refuses a test-only export.
Weakest premise: that deviceKey() reads the key Kosmos+ has enrolled. backupdevicekey.js says a read mid-registration can be the new identity's key; a record signed then verifies only once that registration finishes. Reasoned, not measured.
What would change this: Renet choosing a different byte format for escrowd, which changes only memberKeyRecordBytes and its vector.
