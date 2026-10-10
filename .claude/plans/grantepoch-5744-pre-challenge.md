---
pre_challenge: true
method: challenge-loop
branch: grantepoch-5744
diff_hash: 67821e630cc76c652c0d6d5a365cda91c822d764a4e8a831b3205300cb05b02a
validation: passed
subdir_audit: passed
timestamp: 2026-10-10T20:44:20Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes
**Total findings:** 1 actionable (0 BLOCKERs, 1 WARNING, 0 CONVENTIONs), 9 NITs
**Fixed:** 1 | **Deferred:** 0 | **Asked (awaiting user):** 0

Validation: the full suite on Mortals for hash 67821e630cc7 (18664 tests, 18421 pass, 243 skipped, 0 fail, entry
clean), then `validation_log_run_or_skip` locally (skipped on that clean entry) and the subdir audit (passed).
Red-capability: with main's engine/backupupload.js and engine/backupsnapshot.js, the 3 new tests fail (193 pass);
with the change, 196 pass (203 with engine.reachable.test.js after iteration 1).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/backupsnapshot.js:718: a context epoch backupkeys accepts but no grant can name ('01') failed only at the first upload, after the walk and sealing --> FIXED (fbe27be79: refused up front with backupupload's isKeyEpoch, tested)
- [NIT] the chunk refusal test did not assert grantSpent --> taken (fbe27be79)
- [NIT] no structured code for an epoch mismatch --> not taken (the later lost-key slice sets that contract)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
- [NIT] engine/backupsnapshot.js:620: the comment said the uploader SENDS the epoch with a grant --> taken (bc9b7c019)
- [NIT] the coordinator's answer epoch must be an integer --> checked, not changed: kosmos-relay coordinator/src/backup.rs `pub epoch: i64`
- [NIT] a snapshot test for a mid-run epoch refusal --> not taken

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Converged**: no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/backupsnapshot.js:718 | BRANCH | context epoch refused late | FIXED | fbe27be79 |

### NITs (non-blocking, across all iterations)
- Iteration 3: EPOCH_ID accepts 16 digits, past Number.MAX_SAFE_INTEGER (no real epoch nears it); the manifest test could also count its grant requests and add a string-epoch and no-epoch control; the snapshot test could assert no manifest upload on the up-front refusal.
- Earlier: a structured mismatch code; a mid-run snapshot refusal test.

### Strengths (across all iterations)
- The check runs inside parseGrant and parseManifestGrant, before any PUT, through askSigned's existing refusal path: nothing sent, no extra grant, grantSpent honest (every round).
- Both sources of the epoch are compared (the answer's integer field and each key's segment), with controls showing no over-refusal (every round).
- Opt-in in the uploader, always passed by its one caller; a shared predicate keeps the snapshot and the uploader from drifting (iterations 2, 3).
