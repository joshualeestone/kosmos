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

## Tests (measured at f3dbaeb74: 14 tests, 14 pass)
- engine/backupmemberkey-5744.test.js, against a fake coordinator with the route's rules (wrap opened first, key
  uniqueness across epochs, answers naming epoch and member_public) that opens every wrap with the company secret for
  the exact context: first key at epoch 1, 0600 in 0700; a taken key answered from disk; a lost key gets epoch 2, the
  old stays; a stale key past epoch 3 goes to 4; a rotation inside the day waits (pendingEpoch) and later sends the
  SAME key; a lost answer is a repeat; malformed company answers (one field each), backup_off and an unreadable file
  register nothing; two calls at once agree (not a red arm for the chain); currentEpoch 0 goes to 1; member_key_reused
  gets one fresh key at the same epoch and a code-less 429 nothing; a loose existing folder is made 0700; a kept key
  already held at an older epoch gets a fresh key at the next; an ok answer not naming what was sent is not taken;
  a key another process registered mid-rotation is answered, not replaced.
- Red-capable (each measured): without writing the key before sending, 1 fails (1be4a071f); without the 409 arm, 3
  fail (1be4a071f); without the epoch-0 arm, 1 fails (5052ecedd); without the reused refresh, 2 of 14 fail; without
  the re-read guard, 1 of 14 fails (both f3dbaeb74).
- Neighbours and gates at 1be4a071f: engine/backup*, engine/hpke*, engine.reachable, browser-checks-reason-grep,
  web.speech-kind-1397: 339 tests, 339 pass.

## Review 1 (sonnet)
- Two calls at once could each make a key and the later write replace one Kosmos+ took: MEASURED NOT TO HAPPEN in
  this code (read-to-write has no await, so the second call sees the first's key and sends it, a repeat; the test
  passes with the chain removed). The chain is kept as cheap protection if the store gains an await; the test pins
  the outcome and is not a red arm for the chain.
- FIXED (doc): ensureMemberKey does not ask whether a taken key is still current; the header says the backup job
  compares its epoch with each grant's.
- FIXED: the key folder is chmod 0700 even when it already existed; tested.
- FIXED: the catch-all message no longer says "kept on this computer" for a transport or wrap failure; a failed
  "registered" note after Kosmos+ took the key says so.
- FIXED: wrong_epoch with currentEpoch 0 (no key at all) moves a kept later-epoch key to epoch 1; tested.
- FIXED: the fake opens the wrap before comparing keys, as the real route does; member_key_reused and a 429 with no
  code are tested not to rotate.

## Review 2 (opus)
- FIXED: a kept key moved to a new epoch after a lost answer could hit member_key_reused for good (one key is never
  registered at two epochs); it now gets one fresh key; the fake applies the uniqueness rule; tested.
- FIXED: two PROCESSES on one data root could replace a key the other registered. Premise stated: one board process
  per data root (the board's own lock). Defence: a rotation re-reads the file and answers a key registered meanwhile;
  tested. Within the rotation's other writes the race is not closed.
- DECIDED (a deviation from the v2.1 design, recorded on #5744 and in backupkeys.js's header): the member private key
  is kept in a 0600 file, as mac_key is; the design's wrap to an enrolled device sealing key is not built. Rejected:
  building the sealing key here. Weakest premise: at rest it is as safe as the person's account, no more. What would
  change it: a sealing key in the keychain or Secure Enclave that a board can read.
- CONVENTIONs fixed: the backup-key answer is not signed (the request is); the Tests section re-measured.
- NITs taken: the header names currentEpoch 0; an ok answer must name what was sent; the waiting answer says
  pendingEpoch; one malformed field per case. Not taken: a pk-derives-from-sk check on read (no exported derive in
  backupkeys.js; a bad file then fails at the coordinator with member_wrap_unopenable, not silently).
