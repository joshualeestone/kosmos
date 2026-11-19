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

`ctx.layout = 'handover'` with `ctx.prefix = handover/<org>/<id>/` (built from the `mine` answer, checked against
it): keys must be prefix + one plain segment, there is no period or epoch check, and the uploader takes the hand-over
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
