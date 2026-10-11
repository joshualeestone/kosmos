# kosmos#5744 Mac half, slice 2b: register this computer's member backup key, and a new epoch after a lost key

Plan for the whole Mac half: kosmos#5744 comment 6110117056. Builds on slice 2a (#5851, merged 3e9b63e7):
macRequest returns `refusal: { status, code, currentEpoch }`, currentEpoch only beside member_key_wrong_epoch. Slice 1
(kosmos-relay epochfield-5744) makes the tunnel print that line. Until a tunnel with it ships, `refusal` is absent,
and this slice reads codes only from `refusal`, so neither lost-key arm can fire (see Weakest premise).

## What exists (measured on main 3e9b63e73)
- engine/backupkeys.js: newMemberKey (raw X25519 { sk, pk }), wrapMemberKey(sk, recipientPk, { org, member, epoch }).
  Context ids are strings; the coordinator spells the epoch in decimal (keywrap.rs `epoch={}`), so String(epoch).
- POST /v1/org/backup-key {} answers { org, member, epoch, public_key }: `member` is the signing computer's account,
  "the member id a member key wrap must name" (coordinator/src/escrow.rs, kosmos#5686). The API doc's example omits
  `member` (a doc fix for a later relay PR).
- POST /v1/org/backup/member-key { epoch, member_public, wrap }: first key epoch 1; the same key again is a repeat;
  a new key only at current + 1, once a day (429 member_key_rotation_wait); another key at the current epoch is 409
  member_key_exists; any other epoch is 400 member_key_wrong_epoch with current_epoch.
- Nothing on main calls either route, and nothing runs takeSnapshot.

## The call
- engine/backupmemberkey.js ensureMemberKey({ macRequest }): reads org, member and the company key from one
  backup-key answer (each checked: ids by the shared id rule, the key 32 bytes). A key here that Kosmos+ took is
  answered from disk, no call. Otherwise the newest kept-but-unregistered key (or a new one at epoch 1) is written to
  disk FIRST, then wrapped for (org, member, epoch) and registered. 409 member_key_exists at epoch E means another key
  holds E (this computer lost its key): try E + 1, once. 400 member_key_wrong_epoch with currentEpoch N >= 1: try
  N + 1, once. 429 member_key_rotation_wait: answer `waiting`, keep the key; the next call sends the same key.
- Store: one 0600 JSON file per (org, member) under store.ROOT/backupkeys (0700), via securewrite.writeSecret
  atomicOnly; keys by epoch, raw halves base64url, `registered`. An unreadable or malformed file is never overwritten.
- engine.reachable excuses ensureMemberKey until the backup job (its caller) lands, as worldUsageByModel was.

## Rejected
- Reading the account from the tunnel's cutoffs.json / account file: a second reader of a security-relevant file the
  tunnel owns, and the coordinator's own answer already names the member it will check the wrap against.
- The keychain for the secret: a board started over ssh cannot read it (measured before on Mortals), and the
  tunnel's mac_key is a 0600 file already.
- Retrying past one next epoch: each new epoch is audited and limited to one a day; a loop would burn the day.

## Weakest premise
That the code arrives as `refusal.code`. It does only through slice 1's tunnel line; with an older tunnel a 409 or a
wrong-epoch refusal has no `refusal`, so ensureMemberKey answers ok: false and does not rotate (safe: it never starts
an epoch it cannot read the reason for). Second: a file key is readable by any process running as the person, as
mac_key already is.

## Not in this slice
The backup job that calls this and takeSnapshot; telling the member and the owner on the board about a rotation;
the API doc's missing `member` field.

## Tests
- engine/backupmemberkey-5744.test.js (7), against a fake coordinator with the route's rules that opens every wrap
  with the company secret for the exact context: first key at epoch 1 (file 0600, folder 0700); a taken key answered
  from disk with no second call; a lost key gets epoch 2 (409), the old key stays; a stale epoch-1 key past epoch 3
  goes to 4 (wrong_epoch + currentEpoch); a rotation inside the day waits and later sends the SAME kept key; a lost
  answer after Kosmos+ kept the key is a repeat, not a new epoch; a malformed company answer, backup_off and an
  unreadable key file register nothing and the file is left as it was.
- Red-capable at 1be4a071f: without writing the key before sending, 1 of 7 fails; without the 409 arm, 3 of 7 fail.
- Neighbours and gates at 1be4a071f: engine/backup*, engine/hpke*, engine.reachable, browser-checks-reason-grep,
  web.speech-kind-1397: 339 tests, 339 pass.
