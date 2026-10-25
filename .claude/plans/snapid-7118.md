# snapid-7118: the manifest grant carries the snapshot id a manifest is sealed under (kosmos#7118, Mac half)

## The defect
Opening a backup manifest needs its whole context {org, member, epoch, period, snapshot}. The snapshot id (the UTC time
plus 4 random bytes, engine/backuprun.js newSnapshotId) never left the Mac, so nobody but that Mac could open any
manifest: not a restore destination (#5536), not the console (#5686).

## The call
- engine/backupupload.js uploadManifest takes `snapshot`, checks it by the format's own context-id rule (CTX_ID_RE,
  now exported from backupformat.js so there is one copy of the rule), and sends it with the grant.
- Review: a coordinator from before kosmos#7118 ignores the field and grants anyway, and a manifest stored there
  could never be opened. The grant answer must echo the id; one that does not is refused before any byte is sent.
- engine/backupsnapshot.js passes ctx.snapshot (its one call).
- The coordinator half is kosmos-relay snapid-7118 (keeps it, echoes it, returns it). Deploy the coordinator first;
  until then this Mac refuses manifest grants, which is safe: production backups are off.

## Corrected on the card (blind review)
A coordinator holding the id can present an older genuine manifest of the same period (a rollback of up to a week),
not only make an open fail. Restore must label snapshots by the time inside the id, never by granted_at.

## Weakest premise
That the coordinator half deploys before backups are switched on. If not, Macs refuse every manifest grant (loudly).

## Proof
- engine/backupupload, backupsnapshot, backupformat tests: 217 of 217. Full validation at c2dfb75a5c: 23904 tests,
  0 fail, VALIDATION rc=0 AUDIT rc=0.
- Arms red, each restored: the id not passed, dropped from the body, validation skipped, the echo check dropped.
