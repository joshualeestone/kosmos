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
2. **Coordinator: the sealed pack in transit.** Chunked upload by A's Mac, download by B's, ciphertext only, size cap
   per hand-over (start 500 MB), deleted on B's confirm or after 7 days, counted against a disk floor so a full
   disk refuses rather than fills.
3. **Board on A's Mac** (kosmos): on its org status tick, pack the named agents with the backup snapshot code
   (engine/backupsnapshot.js roots, engine/backupsessions.js with the cap), seal to B's sealing public key, upload,
   report packed. A sees a notice that their company is moving these
   agents to a colleague (not a request for consent: it is the company's work Kosmos, matching #5536's "shown to the
   affected employee unless offboarded").
4. **Board on B's Mac** (kosmos): download, open, make each agent through engine/create.js (a fresh id, as import
   does), restore memory, files, sessions and assignments, start it, confirm received. A's board then stops and
   archives its copies (kept on disk, not deleted) and reports done.
5. **Console** (relay console page): on Remove member, "Hand their agents to" a successor picker, and the same as its
   own action on the member row; progress and failure in words; the audit rows.
6. **Measured on served builds** on a test company (two of our Macs), then switched on for McKinney's company only.

## Decided in slice 1: the key to seal to (13:3x CST 11-18)
B's board's existing X25519 sealing key (engine/fedseal.js `sealingKey`, the federation rooms' key), sent by B's
Mac in a Mac-signed request when its part of the hand-over starts. One sealing, not a third.
Rejected: a new key just for hand-overs (a second key file to lose and back up), and the backup member key (it is
the company's escrowed key, so sealing to it would let escrow open a hand-over, which is not its purpose).
**Residual, stated like fedseal's NOT CLAIMED:** the coordinator relays B's key, so a coordinator that is itself
compromised could substitute its own and read the pack. Federation closes this with a person-to-person secret; a
hand-over has no such channel by default. Mitigation in slice 5: the console and B's board both show a short
fingerprint of the key, for the admin to compare by eye before pressing Hand over. Not compared, not claimed.

## Order of work and dates
- 11-18/19: slice 1 and the plan's review. 11-20/21: slices 2 and 3. 11-22/23: slice 4. 11-24: slice 5.
- 11-25: end-to-end on staging builds. Release cut and coordinator deploy by 11-27, measured, then switched on.
- Slack: 4 days before 12-01. If slice 4 slips, the fallback for the pilot is slices 1-3 plus B importing by hand
  from the pack, which still keeps history.

## Who else
- Renet (#5536): the restore path and escrow; this card must not fork the sealing or the snapshot format.
- PigeonPete: the console page (#8633 invite fix is his).
- Baron: the relay itself, and the release cut that carries slices 3-4.
