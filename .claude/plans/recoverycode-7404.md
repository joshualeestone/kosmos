# recoverycode-7404: a personal backup's key, made and restored with a recovery code (kosmos#7404 step 3, board)

Step 3 is END TO END (decided on the card, 10-30): a personal account's member key is kept by Kosmos+ only wrapped to
a key made from a recovery code the person keeps, so Kosmos+ cannot read the backup. The coordinator half is relay
#691 (merged), restorekey-7404 (the restore read) and recoverytag-7404 (the binding tag, and org/member on the read).

## Pieces in this branch

- **2a, engine/backupkeys.js (pure):** the code (128 bits, 26 Crockford base32 characters, read back forgivingly),
  HKDF to an X25519 wrap key and a separate authentication key, the KBR1 wrap (the coordinator's associated data),
  and the binding tag: HMAC under the code's authentication key over (context, member public key).
- **2b, engine/personalbackupkey.js:** setUp() reads org and member from member-key/mine, makes the code and the
  key, keeps the key before sending, registers KBR1 + recovery_public + tag, answers the code once and writes it
  nowhere. restore(code) requires every row's recovery key to be the code's and its wrap to open with the code AND
  its tag; one bad row refuses the whole restore. Keys go in the company path's key file (backupmemberkey exports
  readKeys/writeKeys), so the backup job reads one place.

## Why the tag (found while building 2a)

HPKE base mode is not authenticated and the coordinator holds the recovery PUBLIC key, so Kosmos+ could wrap a key
of its own that the code opens. A computer that restored it would back up readably to Kosmos+. Only the code holder
can make the tag, and restore requires it. (Old data is safe either way: a forged key cannot open the real chunks.)

## Not here, next slices

Turning personal backup on and showing its words (POST /v1/mac/personal-backup, the codeless enroll), the backup
job choosing this path over ensureMemberKey, a new epoch, the screens (code shown once, printable; the restore
prompt), and the words review. All behind KOSMOS_PERSONAL_BACKUP (off).

## Rejected

A member key derived from the code (no tag needed): a computer without the code could never start a new epoch. A
slow password hash: the code is 128 random bits, so HKDF is enough.

## Weakest premise

That the person keeps the code. Mitigated by the computer's own key file (a signed-in computer can make a new code,
#5744's next-epoch path), so only losing every computer and the code is fatal; the words say so before it turns on.
