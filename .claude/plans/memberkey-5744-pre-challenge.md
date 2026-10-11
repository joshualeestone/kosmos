---
pre_challenge: true
method: challenge-loop
branch: memberkey-5744
diff_hash: 327029ae64a55e4435cf9a49c32beb27d693e8a88468d161ea1b1efd7f23381f
validation: passed (Mortals full suite at afb3969aa, 19181 tests, 18938 pass, 0 fail, 0 cancelled, 2026-10-11 14:37 CDT; local helper skipped on that clean entry, hash 18006a65903c. After it, only the plan changed: review 19 recorded, bec6b0167)
subdir_audit: passed
timestamp: 2026-10-11T19:38:35Z
iterations: 19
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 19 blind reviews, alternating Sonnet (odd) and Opus (even).
**Converged:** Yes, at iteration 19 (Sonnet): no new finding, only entries already in the ledger.
**After convergence:** Mortals validation 1 (at 5679227a5) failed only on tools/test-connector-verbs.sh, whose pinned
list of macRequest callers did not name engine/backupmemberkey.js. Re-decided per that test's rule and added with the
reason (afb3969aa); the second Mortals run passed. Recorded in the plan.
**Findings:** every review's findings and dispositions are below, from the plan's Review sections.
**Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
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

#### Iteration 2
**Reviewer model:** opus
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

#### Iteration 3
**Reviewer model:** sonnet
- FIXED: a file made unreadable before a fresh key or a rotation was overwritten; both now re-read and leave it.
- FIXED: Node's base64url decoder skips characters it does not know, so a non-canonical string could read as a key;
  keys must encode back to what was read.
- Answered with a citation, not a change: several computers per member (the 409 arm's premise). Only the enrolled
  computer gets backup keys (Weakest premise above).
- CONVENTION "fixed": the header said the coordinator's own wrap check bounds the unsigned answer [WRONG, corrected
  by Review 6: that check limits what the coordinator stores, not where the secret is wrapped]. NITs taken: the
  `theirs` sentinel; a comment pinning write-before-send at the move; a test asserts the offline key was kept.

#### Iteration 4
**Reviewer model:** opus
- FIXED: the fresh-key refresh now answers a key another process registered, as the epoch move already did (the
  header claimed both); tested, red without it.
- FIXED: the catch-all put the raw error message, a full file path with the home folder, into `because`; it is now a
  fixed sentence and the error code; tested with a thrown EACCES, red with the raw message.
- NITs taken: one id rule (backupkeys.ID_RE exported and used); the company key's epoch is named as deliberately
  unread; the constructed test state is labelled as one the premise excludes.

#### Iteration 5
**Reviewer model:** sonnet
- FIXED: a wrong_epoch whose next equals the epoch just sent [CORRECTED by Review 10: the coordinator never answers
  this; it reads the current epoch once. The guard is defensive only] deleted the key
  it had just stored and sent `undefined`; it now resends the same key; tested, red without the guard.
- FIXED: an epoch past 2^53 in the file lost precision in Number(); such a file is not read; tested with an
  org-mismatch arm too.
- RECORDED (dependency, not a defect here): the backup job must compare epochs (Not in this slice, and on #5744).
- NIT taken: `!!err &&` removed inside the catch.

#### Iteration 6
**Reviewer model:** opus
- FIXED (the loop's own claim, SELF, from Review 3): the header said the coordinator's wrap check bounds an unsigned
  answer. A forged public_key would get the private key wrapped to the forger before the coordinator is involved;
  the claim is deleted, and the header says the tunnel's TLS is what protects it.
- FIXED (doc): the re-read protects REGISTERED keys only; the header now says so.
- RECORDED (dependency, on #5744): a waiting answer has no retry time; the job backs off on its own.
- NITs taken: the registration-cap test uses its real code (rate_limited); a reversed assertion message; one
  newestRegistered helper for the three copies.

#### Iteration 7
**Reviewer model:** sonnet
- FIXED (Review 3's answer was in the plan only): the header states the one-computer-per-member premise and its
  source (backup-key answers only the enrolled computer).
- FIXED: the reachability excuse names #5535 (E0.6) as where its caller lands.
- Duplicate: the backup job's epoch comparison (Review 5, on #5744).
- NIT taken: the epoch-0 comment covers the "already epoch 1" half.

#### Iteration 8
**Reviewer model:** opus
- STATED (premise, not guarded): one key file per tunnel identity; two data roots sharing one tunnel state would
  each read the other's key as lost. A shipped board has one; the header and Weakest premise say so.
- NITs taken: a wrong_epoch naming the epoch just sent is answered, not a move (tested); the Tests and gate shas
  re-measured at HEAD (353 pass); the job must pass the answered epoch to the uploader (Not in this slice).

#### Iteration 9
**Reviewer model:** sonnet
- STATED (docs): the file holds at most one entry, the newest, and a file with more is answered by its newest
  registered key (W1: unreachable by this code); the job seals only under a key answered ok (W2); a restored data
  root makes a rotation (W3, Not in this slice).
- DEFERRED, not an issue (W4): `because` from the tunnel passes through as every macRequest caller passes it; it is
  the tunnel's own error line (it names the coordinator URL, not a home path).

#### Iteration 10
**Reviewer model:** opus
- FIXED: no way out once a registered key is stale (one computer per member, so a grant for another epoch means this
  file is stale, e.g. a restored data root). `opts.lostEpoch` from the backup job treats that registered key as lost
  and takes the move path once; tested with a control. [Revised by Review 11: the stale key is now KEPT.]
- FIXED (the loop's own claims, SELF, from Reviews 5 and 8): "a race between sends" and "the current epoch moved under
  this send" are answers the coordinator never gives (it reads the current epoch once); the comments say the guards
  are defensive, and the two tests are labelled impossible-answer tests.
- NITs taken: backupkeys.js exports publicKeyOf and a kept pair must be a pair (tested). Noted for a later slice: a
  key file left from a company this computer moved out of is never removed.

#### Iteration 11
**Reviewer model:** sonnet
- FIXED: lostEpoch deleted the only copy of a registered key before a replacement was taken (a wrong signal, or a
  day's wait, left this computer keyless). The stale key is now KEPT (it still opens its own epoch's backups) and
  the new key starts one past it; the re-read guards skip the lost epoch (red without it); tested inside the day.
- FIXED: the "Kosmos+ took it, the note failed" branch is tested (the next call is a repeat, no second epoch).
- Duplicate: the 409-as-lost premise (Reviews 3, 7, 8). NIT taken: the Windows ACL limit is stated.

#### Iteration 12
**Reviewer model:** opus
- FIXED: under lostEpoch the start was always lost + 1, so a second call inside the day made a new key and moved it
  over the pending one (two registrations a call, and a needless rotation if the pending key had been kept). A pending
  key above lost is now sent again. Tested with the pending key at lost + 2 (the member's current epoch ahead); the
  first version of that test put it at lost + 1, where the old code also reused it, and passed with the fix removed;
  rebuilt, it is red without the fix (1 of 26).
- FIXED (doc): the job passes lostEpoch on every call until a newer key is taken.
- NIT taken: the fake's comment says its check order is not the route's own.

#### Iteration 13
**Reviewer model:** sonnet
- FIXED: an unreadable key file failed forever with no distinct signal; the answer now carries `unreadableKeyFile:
  true` so the job can say so (tested).
- FIXED: the echoed member_public is compared as bytes (a lenient decode), so a padded echo of the same key is taken.
- Duplicates: two processes on one data root (Review 2, a stated premise); the excuse names #5535 (Review 7).

#### Iteration 14
**Reviewer model:** opus
- FIXED: under lostEpoch a move could land on a registered key (a current epoch at or below the stale one, which is
  what a coordinator rollback looks like), deleting a key Kosmos+ took. A move never lands on a registered key, and
  on the lost path never at or below the stale epoch; tested with currentEpoch 0 and 1 (red without the guard).
- NITs taken: a comment at `pending` names the file invariant it relies on.

#### Iteration 15
**Reviewer model:** sonnet
- DEFERRED, not an issue (W1): member_key_reused deletes the replaced private half; under the seal-only-under-ok rule
  nothing this computer sealed is under a key it never recorded as registered. The header now says so.
- FIXED: a lostEpoch that matches nothing answers `lostEpochIgnored: true`, so the job notices (tested).
- FIXED (test): a non-wait failure right after a move keeps the moved key and the next call sends it there.
- NITs taken: a looser key file is made 0600 on read (tested); the chain comment says in-process only.

#### Iteration 16
**Reviewer model:** opus
- FIXED: a job that forgot lostEpoch got the stale key with no sign a newer one was pending; an answer from disk now
  names `pendingEpoch` when an unregistered key sits above the registered one (tested).
- NITs taken: lostEpochIgnored's comment says it rides the from-disk answer; the read-time chmod runs only after the
  file read as ours and not through a symlink; the echo comment names Node's skipped characters; the ignore-path test
  asserts the flag and that nothing was sent.

#### Iteration 17
**Reviewer model:** sonnet
- FIXED: the file invariant (one unregistered entry at most, the newest) is now checked on read; a file breaking it
  is answered unreadableKeyFile (tested with an older pending entry and with two).
- DEFERRED, stated: every call asks backup-key, so offline it answers ok: false with a key on disk; a backup needs a
  grant from Kosmos+ anyway (header).
- Duplicate: the reused-key deletion (Review 15).
- NITs taken: the test helper picks the .json file; a test pins that the company key's epoch is not read.

#### Iteration 18
**Reviewer model:** opus
- FIXED: `lostEpoch: null` (a natural "none") flagged lostEpochIgnored on every answer; the flag needs a non-null
  lostEpoch (tested).
- NITs taken: a symlinked key file is refused outright (tested); the 2^53 fixture is a string so it is past 2^53;
  the header says the flags ride only an answer from disk; UNREADABLE sits after the routes.

#### Iteration 19
**Reviewer model:** sonnet
- CONVERGED: no new finding; it repeated entries already in this ledger. Comment-wording NITs were left alone so the
  diff stays the converged one. (Recorded here at 14:38 CDT from the session transcript; the earlier session had not
  written this section.)
