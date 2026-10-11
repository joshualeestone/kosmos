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
- One key file per tunnel identity: two data roots sharing one tunnel state (AGENT_WORKFORCE_TUNNEL_STATE, a test
  or development setup) would each read the other's key as lost and rotate in turn. Stated, not guarded.
- One computer per member gets backup keys. The coordinator enforces it: POST /v1/org/backup-key refuses 403
  backup_not_member when "the computer is not its enrolled one" (docs/coordinator-api.md, Org backup key). So the
  409 member_key_exists arm reads "another key holds this epoch" as "this computer lost its key"; a second computer
  of the same member never reaches the member-key route.
That the code arrives as `refusal.code`. It does only through slice 1's tunnel line; with an older tunnel a 409 or a
wrong-epoch refusal has no `refusal`, so ensureMemberKey answers ok: false and does not rotate (safe: it never starts
an epoch it cannot read the reason for). Second: a file key is readable by any process running as the person, as
mac_key already is.

## Not in this slice
DEPENDENCY for the backup job (recorded on #5744): ensureMemberKey answers a registered key from disk without asking
whether it is still current, so the job MUST compare the epoch it answers with each grant's `epoch` and treat a
mismatch as "the member moved on"; until that job lands nothing detects it. ALSO: a `waiting` answer carries no
retry time (the coordinator's retry_after_secs does not ride in the tunnel's refusal line), so the job must back
off on its own: each early retry costs a round trip, and past the day each send counts toward the registration cap.
AND: the job seals only under a key answered ok (an unregistered key may be replaced). AND: restoring an old copy
of the data root whose key was never marked registered makes a rotation, not a recovery of the old key.
AND: backupupload.js checks a grant's epoch only when `opts.epoch` is passed (epochProblem is null without it), so the
job must pass the epoch ensureMemberKey answers (a Number; sealedEpoch converts it).
The backup job that calls this and takeSnapshot; telling the member and the owner on the board about a rotation;
the API doc's missing `member` field.

## Tests (measured at 805fa52d1: 21 tests, 21 pass)
- engine/backupmemberkey-5744.test.js, against a fake coordinator with the route's rules (wrap opened first, key
  uniqueness across epochs, answers naming epoch and member_public) that opens every wrap with the company secret for
  the exact context: first key at epoch 1, 0600 in 0700; a taken key answered from disk; a lost key gets epoch 2, the
  old stays; a stale key past epoch 3 goes to 4; a rotation inside the day waits (pendingEpoch) and later sends the
  SAME key; a lost answer is a repeat; malformed company answers (one field each), backup_off and an unreadable file
  register nothing; two calls at once agree (not a red arm for the chain); currentEpoch 0 goes to 1; member_key_reused
  gets one fresh key at the same epoch and a code-less 429 nothing; a loose existing folder is made 0700; a kept key
  already held at an older epoch gets a fresh key at the next; an ok answer not naming what was sent is not taken;
  a key another process registered mid-rotation is answered, not replaced; a non-canonical base64url key is not read
  (red without the check, 1 of 16, at 4db7061a0); a file made unreadable mid-rotation is left as it is; a key
  another process registered before a fresh-key refresh is answered (red without the check, 1 of 18); a file error
  is said as a fixed sentence and its code, no path (red with the raw message, 1 of 18; both at 266cfd43f); a
  wrong_epoch whose next is the epoch just sent resends the same key (red without the guard, 1 of 20, c9c9056e0);
  a file for another org or with an epoch past 2^53 is not read; a wrong_epoch naming the epoch just sent (an
  impossible answer, labelled so) is answered, not a move; lostEpoch moves a stale registered key once; a pair whose
  public half is not the private half's is not read.
- Red-capable (each measured): without writing the key before sending, 1 fails (1be4a071f); without the 409 arm, 3
  fail (1be4a071f); without the epoch-0 arm, 1 fails (5052ecedd); without the reused refresh, 2 of 14 fail; without
  the re-read guard, 1 of 14 fails (both f3dbaeb74).
- Neighbours and gates at 805fa52d1: engine/backup*, engine/hpke*, engine.reachable, browser-checks-reason-grep,
  web.speech-kind-1397: 353 tests, 353 pass.

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

## Review 3 (sonnet)
- FIXED: a file made unreadable before a fresh key or a rotation was overwritten; both now re-read and leave it.
- FIXED: Node's base64url decoder skips characters it does not know, so a non-canonical string could read as a key;
  keys must encode back to what was read.
- Answered with a citation, not a change: several computers per member (the 409 arm's premise). Only the enrolled
  computer gets backup keys (Weakest premise above).
- CONVENTION "fixed": the header said the coordinator's own wrap check bounds the unsigned answer [WRONG, corrected
  by Review 6: that check limits what the coordinator stores, not where the secret is wrapped]. NITs taken: the
  `theirs` sentinel; a comment pinning write-before-send at the move; a test asserts the offline key was kept.

## Review 4 (opus)
- FIXED: the fresh-key refresh now answers a key another process registered, as the epoch move already did (the
  header claimed both); tested, red without it.
- FIXED: the catch-all put the raw error message, a full file path with the home folder, into `because`; it is now a
  fixed sentence and the error code; tested with a thrown EACCES, red with the raw message.
- NITs taken: one id rule (backupkeys.ID_RE exported and used); the company key's epoch is named as deliberately
  unread; the constructed test state is labelled as one the premise excludes.

## Review 5 (sonnet)
- FIXED: a wrong_epoch whose next equals the epoch just sent [CORRECTED by Review 10: the coordinator never answers
  this; it reads the current epoch once. The guard is defensive only] deleted the key
  it had just stored and sent `undefined`; it now resends the same key; tested, red without the guard.
- FIXED: an epoch past 2^53 in the file lost precision in Number(); such a file is not read; tested with an
  org-mismatch arm too.
- RECORDED (dependency, not a defect here): the backup job must compare epochs (Not in this slice, and on #5744).
- NIT taken: `!!err &&` removed inside the catch.

## Review 6 (opus)
- FIXED (the loop's own claim, SELF, from Review 3): the header said the coordinator's wrap check bounds an unsigned
  answer. A forged public_key would get the private key wrapped to the forger before the coordinator is involved;
  the claim is deleted, and the header says the tunnel's TLS is what protects it.
- FIXED (doc): the re-read protects REGISTERED keys only; the header now says so.
- RECORDED (dependency, on #5744): a waiting answer has no retry time; the job backs off on its own.
- NITs taken: the registration-cap test uses its real code (rate_limited); a reversed assertion message; one
  newestRegistered helper for the three copies.

## Review 7 (sonnet)
- FIXED (Review 3's answer was in the plan only): the header states the one-computer-per-member premise and its
  source (backup-key answers only the enrolled computer).
- FIXED: the reachability excuse names #5535 (E0.6) as where its caller lands.
- Duplicate: the backup job's epoch comparison (Review 5, on #5744).
- NIT taken: the epoch-0 comment covers the "already epoch 1" half.

## Review 8 (opus)
- STATED (premise, not guarded): one key file per tunnel identity; two data roots sharing one tunnel state would
  each read the other's key as lost. A shipped board has one; the header and Weakest premise say so.
- NITs taken: a wrong_epoch naming the epoch just sent is answered, not a move (tested); the Tests and gate shas
  re-measured at HEAD (353 pass); the job must pass the answered epoch to the uploader (Not in this slice).

## Review 9 (sonnet)
- STATED (docs): the file holds at most one entry, the newest, and a file with more is answered by its newest
  registered key (W1: unreachable by this code); the job seals only under a key answered ok (W2); a restored data
  root makes a rotation (W3, Not in this slice).
- DEFERRED, not an issue (W4): `because` from the tunnel passes through as every macRequest caller passes it; it is
  the tunnel's own error line (it names the coordinator URL, not a home path).

## Review 10 (opus)
- FIXED: no way out once a registered key is stale (one computer per member, so a grant for another epoch means this
  file is stale, e.g. a restored data root). `opts.lostEpoch` from the backup job treats that registered key as lost
  and takes the move path once (its backups stay readable through escrow); tested with a control.
- FIXED (the loop's own claims, SELF, from Reviews 5 and 8): "a race between sends" and "the current epoch moved under
  this send" are answers the coordinator never gives (it reads the current epoch once); the comments say the guards
  are defensive, and the two tests are labelled impossible-answer tests.
- NITs taken: backupkeys.js exports publicKeyOf and a kept pair must be a pair (tested). Noted for a later slice: a
  key file left from a company this computer moved out of is never removed.
