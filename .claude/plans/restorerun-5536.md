# restorerun-5536: the restore driver, one snapshot through the real parts (kosmos#5536 slice 1)

Design: #5536 comment 6399924599 (corrected by review 1, below).

## The call
engine/restorerun.js: newDestination (an X25519 pair made here, fingerprinted as restorerequest.js names a
destination; the private half never leaves it), listSnapshots (labelled by the time inside each id, never granted_at,
never "latest"), runRestore (the device key chosen from the escrowd-signed history by the coordinator's RECORDED grant
time; the manifest checked against its recorded sha256; chunks fetched through the manifest's own objects map; then
backuprestore into the caller's sink). Not wired yet: its sources are the read grants (#5686 c) and the history
(#7116 slice 2); excused in engine.reachable with that reason.

## Rejected
- Choosing the key by the id's own time: a retired-key holder dates a forged manifest inside that key's window.

## Review 1 (blind): no BLOCKER; the design corrected
The id-time check is consistency, not security: a retired-key holder writes any id time, and an honest coordinator's
granted_at alone decides the key. As first written it would have refused genuine backups for ever (a Mac clock a
little fast; a run across Monday 00:00; a first upload over six hours). Now: a clock allowance after the grant, a
period and a day before it, no week rule (the period is in the signed context). Also taken: ok only when files were
restored; a deadline on every fetch and bytes only; object keys must be this member's; inputs refused by name; the
list sort and bound. Residuals stated in the header: a breached coordinator can move granted_at, and can hide (not
relabel) snapshots.

## Weakest premise
That granted_at from an honest coordinator is close enough to the device key's validity that a Mac re-registration
between a snapshot and its grant never leaves the signing key outside every window. If it does, that snapshot is
refused by name ("no device key ... valid when this backup was recorded"), not misrestored.

## Proof
- engine/restorerun-5536.test.js: 7 pass (a real snapshot, a really signed history, a real wrap).
- With the repo-scanning guards that name these modules: 74 of 74.
- Arms red, each restored: key by claimed time, no sha check, no time check, no clock allowance, the week rule back,
  ok without the result shape, no key check. A no-timeout arm is not run: it hangs, which is the defect it guards.
