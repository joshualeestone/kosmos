# handover-8710-s3: the leaving computer packs and sends (kosmos#8710, slice 3, board side)

Card: kosmos#8710. Relay contract: kosmos-relay #844 (slice 2), routes under `/v1/mac/org/handover/`:
`mine {}`, `grant {id, chunks:[{size, md5}]} -> {uploads, expires_at}`, `manifest {id, sha256, size} -> one upload`.
Planned 2026-11-19 08:4x CST, Ice Cream Kitty.

## Correction to the card's slice 3 line ("takeSnapshot reused whole")

Measured in engine/backupsnapshot.js and engine/backupupload.js: the crypto fits a hand-over as it is. The receiver's
one-time key stands where the member key does (memberPk), the naming key is new per pack and travels wrapped to that
key in the signed manifest, and the device key signs it. Three backup assumptions do NOT fit:

1. Object paths. `keyProblem` accepts only `<org>/<account>/<epoch>/<period>/<random>`; slice 2 names hand-over
   objects `handover/<org>/<handover-id>/<random>` (the bucket's IAM policy and 14-day lifecycle are on `handover/`).
2. Period and epoch. A snapshot's ctx.period must be this week's and every key must carry ctx.epoch; a hand-over has
   neither.
3. Locks. The uploader refuses any grant without the COMPLIANCE lock headers (29 to 39 days); hand-over grants are
   deliberately unlocked (`presign_put_unlocked`), and the grant answer carries no epoch, period or retain_until.

## The call: one explicit hand-over layout in the two modules, not a second pack format

`ctx.layout = 'handover'` with `ctx.prefix = handover/<org>/<id>/` (built from the enrolled company's id and the
`mine` row's id; the coordinator's grant refuses any other): keys must be prefix + one plain segment, there is no period or epoch check, and the uploader takes the hand-over
grant shape and requires the lock headers to be ABSENT (a lock on a transient pack would leave 30 days of undeletable
objects). Every check that is not about layout (digests, signed headers, https, AWS host, If-None-Match, no repeated
key or url, the 412 rule) stays exactly as it is for both layouts.

Rejected:
- A separate pack format (tar + seal). A second format and a second opener for B, the same reason fedseal's key was
  rejected on 11-18.
- Coordinator naming hand-over keys in the backup's five-part shape, with ctx.org standing for something else. It
  bends the signed context's meaning to pass a shape check.

Weakest premise: that the layout switch can be made without loosening the backup path. Every backup test must
still pass unchanged, and each new hand-over branch needs a test that the BACKUP layout still refuses the hand-over
shape (and the reverse), so the switch cannot become a way around a backup check.

## What this slice builds
- engine/handoversend.js: on the org status tick, `mine`; for a `send` part in `packing` with a `seal_pub`, pack the
  named agents (each agent's folder, memory, Files; sessions newest first up to 50 MB per agent through
  backupsessions.js), takeSnapshot with the hand-over layout and the grant/manifest routes, then report via `manifest`.
  One run at a time; a lost answer resumes from state, never a second pack.
- The notice to the leaving member (their company is moving these agents to a colleague).
- Tunnel allowlist for the six paths (crates/tunnel/src/coordinator.rs).
- Not here: the receiving side (slice 4), the console screen (slice 5).

## The pack's context (decided 09:0x CST 11-19)
The successor needs the manifest's exact context to open it, and slice 2's `mine` answer carries none. Rather than
change the coordinator, the context follows from the hand-over: `{ org, member: <handover id>, epoch: 'handover',
period: 'handover', snapshot: <handover id> }` (backupformat CTX_ID_RE strings). Both computers know it (org from
the prefix / enrolment, the id from `mine`), it is unique per hand-over so another hand-over's pack cannot be passed
off as this one, and the leaving computer's device signature over it is checked against `sender_pubkey`.
Rejected: a new coordinator column holding a context the sender reports (a slice 2 change for information both
sides already hold). Weakest premise: that nothing in restore treats `period` as a week. Checked: backuprestore.js
does not read the period; the snapshot's week checks are skipped only under the hand-over layout.

## handoversend.js design (09:0x CST 11-19, from reading engine/backuptick.js, register.js, backupsessions.js)
- Names: a hand-over names agents as the rollup reports them (orgrollup gather: a running card's `name`, a stopped
  agent's `shownAs || name` from register.survey()). Resolve each with the same sources: survey() rows where
  profile === true and !removed, matching `shownAs || name`; act on `name` (register.js: "ACT ON name, SPEAK
  shownAs"). A name that matches none, or more than one, fails the pack with that name in the sentence.
- Roots per agent `<seg>` (backuptick rootSegment of the name):
  - `agents/<seg>`: create.workerDir(name) (holds its instructions file and its Files folder, dmfiles.filesDir).
  - `profiles/<seg>`: store.PROFILES with `only: ['<name>.json']`; the receiver strips per-install fields the way
    agentfile.js does (slice 4).
  - `sessions/<seg>/...`: backupsessions.sessionsFor(dir, {...}) with the SAME inputs backuptick builds (its
    input.sessions callback, ~lines 211-310: claudeRoots, gemini/codex/grok homes, museData, moreHomes); reuse by
    exporting that builder from backuptick, not by copying it. Then trim each root's `only` list to the newest files
    up to 50 MB per agent (mtime order), so a 2 GB history carries recent context only.
  - Never the data root, credentials or provider sign-ins (backuptick's protect list applies: pass the same).
- Keys: memberPk = Buffer.from(seal_pub, 'base64') (32 bytes, else refuse); deviceKey = backupdevicekey.deviceKey()
  (the connector's mac_key = the coordinator's sender_pubkey); a NEW naming key per pack (backupkeys.newNamingKey);
  ctx = backupsnapshot.handoverContext(org, id); org from orgenroll status; prefix `handover/<org>/<id>/`.
- Tick: on the org status tick (where orgrollup / backuptick start), POST /v1/mac/org/handover/mine {}; for each
  part with side 'send', state 'packing' and a seal_pub: one pack at a time (a module-level in-flight guard), never
  while another is running. On ok, the manifest grant already moved the record to `packed`. On failure: keep state,
  retry next tick only for retryLater; record other failures in a local file the notice can read.
- Notice to the leaving member: "<company> is moving <agents> to a colleague's computer." (shown, not a consent ask).
- Tunnel allowlist: the six /v1/mac/org/handover/* paths (kosmos-relay crates/tunnel/src/coordinator.rs ~696).
  CHECK FIRST whether remote.macRequest refuses a path the tunnel does not list (it may only be the tunnel side).

## Progress 2026-11-19 09:08 CST
- DONE (ccda2b2bf4): engine/handoversend.js + engine/handoversend-8710.test.js (9 tests, 8x repeat clean, 5 mutations all
  red: protect, packed memo, trim break, removed/stray names, trial seal). backuptick exports rootSegment. server.js starts
  it after backuptick.startHere, off unless KOSMOS_ORG_HANDOVER=1. tools/test-connector-verbs.sh re-decided (27/27 local).
- Tunnel allowlist for the six paths: already in kosmos-relay #844 (coordinator.rs 745-750, 925-930). Nothing to do here.
- Found in flight: a random 32-byte seal_pub fails ~50% (bit 255 set is not a canonical X25519 key), and the snapshot
  then says only "failed unexpectedly". packInput now trial-seals with hpke and refuses with a sentence.
- REMAINING: member notice (needs a screen surface: state.failed / packing to the board's org status), then review
  loop (cap 8), full suite after round 1, PR.
