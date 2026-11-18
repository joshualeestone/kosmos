# handover-8710: hand a departing member's agents to a successor (continuity in a seat)

Card: kosmos#8710. Deadline: working in prod before 2026-12-01 (McKinney pilot). Owner: Ice Cream Kitty.
Repos: kosmos-relay (coordinator, console) and kosmos (board). Planned 2026-11-18.

## What "done" means (the card's own test)
On a test company: member A's agent is handed to member B, keeps its role and history, answers B on B's computer,
and the audit log shows the hand-over. Measured on a served build (0.8.11 or the release after, plus a coordinator
deploy).

## The call: a LIVE hand-over, Mac to Mac, sealed end to end. Not a restore from backup.

The admin starts it in the console. A's Mac packs the chosen agents and seals the pack to B's Mac. The coordinator
carries only ciphertext it cannot open. B's Mac opens it and makes the agents through the ordinary create path.
A's copies stop once B confirms.

Rejected:
- **Build it on #5536's restore from backup.** That path needs company backups switched on (they are not, for
  anyone), a backup destination the company registers, two-admin passkey approval and escrowd release. None of that
  is live, and the admin enrolment it waits on is itself blocked. It cannot be in prod by 12-01. It stays the answer
  for "A's Mac is gone", later.
- **Coordinator holds the agents' keys or plaintext.** Ruled out by the coordinator's standing rule (no customer key
  except Enterprise escrow). B's Mac publishes a sealing public key instead (see "Open in slice 1").
- **Agent file export and import only** (engine/agentfile.js). It carries instructions only, so "keeps its history"
  fails.

Weakest premise: **that A's Mac is still on and online when the admin starts the hand-over.** For a city staffer
handing back a laptop to IT that is the normal case, but a lost, broken or wiped Mac gets nothing from this.
The console must say so plainly ("Kosmos moves the agents from <A>'s computer, so it must be on") and offer the
backup route as "coming" until #5536 is live. What would change my mind: McKinney telling us departures usually
mean the laptop is already gone; then the backup route is the priority and this card is the wrong shape.

## What travels (decided; overturn on the card)
Per agent: its instructions and profile (minus the per-install fields agentfile.js already strips), its memory
folder, its Files folder, its task assignments and DM history as the board records them, and its project
memberships. Session transcripts: the newest sessions up to a cap (start at 50 MB per agent), newest first.
Older ones stay on A's Mac and in any backup.

Why the cap: one real agent here is 81 MB of folder but 2.0 GB of transcripts (measured 11-18 on this Mac), and
the coordinator has 19 GB free in total. The cap carries recent context, which is what "keeps doing the job"
needs; the whole archive is a backup's job.

Projects: an agent's membership in a project that lives on A's Mac. Two options:
  (a) move the project folder with it, or
  (b) share the project to B through federation (already built, sealed rooms).
Call: (a) for a project only A's handed agents are in; (b) where people other than A are in it, so it is not taken
from them. Weakest point: (b) leaves the project on A's Mac, which is going away; flagged as slice 5's open question.

## Slices (in order; each merges dark behind KOSMOS_ORG_HANDOVER=1 on the coordinator)
1. **Coordinator: the hand-over record and its audit** (relay). `POST /v1/org/members/handover` {from, to, agents}
   by an admin; states requested -> packed -> received -> done | failed | cancelled; each change is an org_audit row.
   B must be a current member with an enrolled computer. `GET /v1/mac/org/handover` tells A's and B's Macs their part.
2. **The sealed pack in transit: presigned object storage, not the coordinator's disk and not the tunnel.**
   Measured 11-18: the tunnel caps a Mac request body at 64 KB (crates/tunnel/src/coordinator.rs
   MAC_REQUEST_MAX_BODY), so a 50 MB pack would be about a thousand signed requests per agent. The coordinator
   already presigns S3 PUTs and GETs for backups (coordinator/src/backup.rs), and the board already uploads
   presigned chunks (engine/backupupload.js). Reuse both: the coordinator hands A's Mac presigned PUTs and B's Mac
   presigned GETs for keys it builds from the hand-over id; ciphertext only; a per-hand-over size cap (start
   500 MB); objects deleted on B's confirm, with a 7-day bucket lifecycle as the backstop.
   **CORRECTED 16:0x CST 11-18:** the bucket must be AWS S3. backup.rs's signer takes only an AWS commercial region
   (`region_ok`) and a custom endpoint only as a local dev test store (`dev_endpoint`), so a Hetzner bucket would need
   a code change (and its storage is believed EU-only, unchecked). Josh told via Splinter to skip the Hetzner bucket.
   The one ruling asked: may packs live in the AWS account we hold (Claw Cabal LLC, 230470759562, us-east-2, user
   kosmos-agent)? Splinter's lean: no, a Kosmos-owned account. If yes, I make the bucket myself.
   The paragraph below is the 13:4x version, kept as history.
   **DEPENDENCY, needs an operator:** prod has no object store configured (no backup store variable in the
   coordinator env, 11-18). It needs a bucket we own and a key limited to that bucket. Which provider account is
   Kosmos's, and not another company's, is the question to settle first (our existing storage keys on this Mac may
   belong to Stuff.io, a separate company). Raised 11-18 13:4x.
3. **Board on A's Mac** (kosmos): on its org status tick, pack the named agents with `takeSnapshot`
   (engine/backupsnapshot.js; sessions through engine/backupsessions.js with the cap), sealed to B's one-time
   public key, uploaded with the hand-over's grants, report packed. A sees a notice that their company is moving these
   agents to a colleague (not a request for consent: it is the company's work Kosmos, matching #5536's "shown to the
   affected employee unless offboarded").
   New Mac paths need the tunnel's allowlist (crates/tunnel/src/coordinator.rs, near line 696) and so a new tunnel
   build in the kosmos release; slices 3-4 ride that release anyway.
4. **Board on B's Mac** (kosmos): download, open, make each agent through engine/create.js (a fresh id, as import
   does), restore memory, files, sessions and assignments, start it, confirm received. A's board then stops and
   archives its copies (kept on disk, not deleted) and reports done.
5. **Console** (relay console page): on Remove member, "Hand their agents to" a successor picker, and the same as its
   own action on the member row; progress and failure in words; the audit rows.
6. **Measured on served builds** on a test company (two of our Macs), then switched on for McKinney's company only.

## Decided: the pack IS a backup snapshot, sealed to a one-time key of B's (revised 13:4x CST 11-18)
The first version of this section chose B's federation sealing key. Retracted: engine/backupsnapshot.js
`takeSnapshot` seals to a backup-format member public key and engine/backuprestore.js `restoreSnapshot` opens with
its secret half (`memberSk`), so sealing to a federation key would mean a second pack format and a second opener.
Instead:
- B's board makes a ONE-TIME key pair of the backup format's own type for this hand-over, keeps the secret half on
  B's Mac only, and sends the public half in a Mac-signed request. One key per hand-over, discarded after B opens.
- A's board runs `takeSnapshot` over the handed agents' roots (backupscan's deny-list and content scan apply as for
  a backup), sealed to that public key, the manifest signed with A's device key as a backup's is.
- B's board runs `restoreSnapshot` with the secret half and A's device public key (from the coordinator) into a
  staging folder, then makes the agents from it.
So the hand-over reuses the reviewed walker, sealer, uploader and restorer whole; what is new is only who holds the
key and where the grants come from.
**Residual (unchanged):** the coordinator relays B's public key and A's device key, so a compromised coordinator
could substitute keys and read or forge a pack. Mitigation in slice 5: the console and both boards show a short
fingerprint of the hand-over key, for the admin to compare by eye. Not compared, not claimed.

## Slice 2 design (read from relay main 11-18 15:5x CST, not built yet)
- Reuse coordinator/src/backup.rs whole: `presign_put` / `presign_get` against a `BackupStore`, its own store config
  (`KOSMOS_HANDOVER_STORE_*`, the same fields as the backup store's), so a hand-over never writes into a company's
  own backup destination (`org_backup_destinations`) or ours by accident.
- Keys built by the coordinator from the AUTHENTICATED Mac and the hand-over id: `handover/<org>/<handover id>/...`,
  never from the request. A's Mac gets PUTs only while its hand-over is `packing`; B's Mac gets GETs only while
  `packed` or `receiving`, and only for its own hand-over.
- **No object lock (decided 16:0x CST 11-18).** backup.rs's `presign_put` locks every object COMPLIANCE until a date,
  which needs a bucket made with Object Lock and makes the pack undeletable. A pack is transient, so hand-over PUTs are
  signed without the lock headers (still `If-None-Match: *`, write-once), the coordinator deletes the pack when B
  confirms, and a 7-day lifecycle rule is the backstop. So the bucket asked of Josh is a plain private one. Rejected:
  the locked backup bucket (a company's backups and a hand-over's pack in one place, and a pack kept for 30 days).
  Weakest premise: that the delete credential on the coordinator is acceptable; backups deliberately hold PutObject only.
- The bucket is NOT needed to build or test this: backup.rs's tests run against a loopback store (`dev_endpoint`).
  Only switching it on in prod waits on the Kosmos-owned bucket (asked of Josh 11-18 12:56 via Splinter).
- Board side (slice 3) drives `engine/backuprun.js` `runBackup` with: the member key = B's one-time public key, the
  hand-over's grant routes in place of the backup grant routes, and roots = only the named agents' folders.

## Carried to slices 2-4 (from slice 1's post-rebase review, 16:2x CST 11-18)
- A hand-over is cancelled when a MEMBERSHIP ends, not when a member's computer is unjoined while they stay. Slice 1
  never acts on an open hand-over, so it is harmless there; every Mac-side step (key, grant, manifest, read, done) must
  check that the calling computer is still the member's enrolled one, and refuse otherwise.

## Order of work and dates
- 11-18/19: slice 1 and the plan's review. 11-20/21: slices 2 and 3. 11-22/23: slice 4. 11-24: slice 5.
- 11-25: end-to-end on staging builds. Release cut and coordinator deploy by 11-27, measured, then switched on.
- Slack: 4 days before 12-01. If slice 4 slips, the fallback for the pilot is slices 1-3 plus B importing by hand
  from the pack, which still keeps history.

## Who else
- Renet (#5536): the restore path and escrow; this card must not fork the sealing or the snapshot format.
- PigeonPete: the console page (#8633 invite fix is his).
- Baron: the relay itself, and the release cut that carries slices 3-4.
