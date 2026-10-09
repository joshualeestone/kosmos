---
pre_challenge: true
method: challenge-loop
branch: bkupload-5535
diff_hash: 1cbec09191d85e4fcf9be1d488d1247426febaf03eff9130231b9a885ed0fb32
validation: failed ONLY on main's known red (Mortals, 17124 tests, 16883 pass, 1 fail: engine.reachable.test.js usageprice.js costOf, red on main since 12:03 from #5556, fix PR #5600; plain main fails it too; nothing from this branch)
subdir_audit: passed
timestamp: 2026-10-08T19:59:33Z
iterations: 16
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 16
**Converged:** Yes, at iteration 16 (sonnet): five NITs, no BLOCKER, WARNING or CONVENTION.
**Total findings:** every round 1 to 15 found at least one actionable issue (rounds 1 and 15 a BLOCKER each: round 1, the uploader built to the plan instead of the coordinator's real slice-2 shape, refusing every real grant after its allowance was spent; round 15, engine.reachable failing on an unregistered test seam). Each round's commit ("address challenge-loop iteration N findings") lists its fixes; this proof quotes the first item of each and does not invent category counts. Other rounds' main items are listed as [WARNING] (my reading).
**Fixed:** all actionable findings in rounds 1 to 15 | **Deferred:** round 16's NITs (each chunk MD5-hashed twice; a comment's wording on the test seam; an abort mid error-body read mislabels an expiry as refused, fail-safe; 408/425 from a proxy stop the run, conservative; a 5xx before the body was read over-reports unsure, by design) | **Asked:** 0
**Red-checks:** every rule added from round 1 on was red-checked by a mutant with its fix removed, read by pass AND fail counts after round 7 (a test file that would not parse had read as three red-checks). Cases found vacuous by that check and rewritten: the url-to-key and repeated-url cases, the slow-uplink sizing, the path rule, the website mutant, the ASCII rule (first thought not isolable), the 8 KB read cap.
**Contract:** built against Ice Cream Kitty's slice-2 coordinator code (kosmos-relay putgrant-5535, coordinator/src/backup.rs), read directly; its shape changed during review (ISO expires_at, no Content-Length in headers) and the code follows the code, not the plan's first description.
**Reviewer models:** opus on odd iterations, sonnet on even.

### Per-Iteration Breakdown
#### Iteration 1
**Reviewer model:** opus
- [BLOCKER] engine/backupupload.js - the binding is checked from the url's X-Amz-SignedHeaders, each url must carry its own key, and no url repeats; --> FIXED (commit 0013c45db; its message lists the round's other fixes)

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] engine/backupupload.js - Grant headers are allow-listed (four names, plus content-length), never twice, printable only. --> FIXED (commit 40a569459; its message lists the round's other fixes)

#### Iteration 3
**Reviewer model:** opus
- [WARNING] engine/backupupload.js - After trouble, S3's 'expired' ends the run retryLater instead of a new grant (reproduced by the reviewer: the same bytes locked twice under two keys). --> FIXED (commit 58f559fb1; its message lists the round's other fixes)

#### Iteration 4
**Reviewer model:** sonnet
- [WARNING] engine/backupupload.js - A PUT's timeout is not capped at the grant's remaining time: S3 checks expiry on arrival, so a PUT started in time may finish; aborting it made a landed write an unknown. --> FIXED (commit 119b77c2a; its message lists the round's other fixes)

#### Iteration 5
**Reviewer model:** opus
- [WARNING] engine/backupupload.js - The url's query is allow-listed to SigV4's six parameters, each once: S3 honours x-amz-* parameters in the query (a legal hold, a retention, an uploadId), which the header checks never saw. --> FIXED (commit 53528e67c; its message lists the round's other fixes)

#### Iteration 6
**Reviewer model:** sonnet
- [WARNING] engine/backupupload.js - S3 400 RequestTimeout / IncompleteBody retry the same url; 501 is refused. --> FIXED (commit 941a0c90d; its message lists the round's other fixes)

#### Iteration 7
**Reviewer model:** opus
- [WARNING] engine/backupupload.js - Grants are sized from the rate the last one achieved (80% of a window, at most double, 1 to 500): the old double-or-shrink rule swung and asked for about 30% more allowance than it stored. --> FIXED (commit 67fd4e600; its message lists the round's other fixes)

#### Iteration 8
**Reviewer model:** sonnet
- [WARNING] engine/backupupload.js - A grant repeating a key an earlier grant in the run gave is refused (the 412 rule needs run-wide unique keys). --> FIXED (commit 02d369ca9; its message lists the round's other fixes)

#### Iteration 9
**Reviewer model:** opus
- [WARNING] engine/backupupload.js - A grant that ran out counts as a whole window in the sizing rate, so S3 ending grants early cannot make sizing over-ask (measured 8.3x before; now within 1.6x in the test). --> FIXED (commit f88e4c124; its message lists the round's other fixes)

#### Iteration 10
**Reviewer model:** sonnet
- [WARNING] engine/backupupload.js - Upload hosts pinned to AWS S3 endpoints on the default port (reverses my round-4 call: a coordinator bug must not aim a Mac's upload at another host). --> FIXED (commit a87219190; its message lists the round's other fixes)

#### Iteration 11
**Reviewer model:** opus
- [WARNING] engine/backupupload.js - A 412 is ours only after an attempt that may have written the chunk: not after pre-connect failures (which send nothing) or S3's 'nothing committed' 400s. Before, ECONNREFUSED then 412 recorded a key that could hold someone else's bytes (reproduced by the reviewer). --> FIXED (commit dedeebfe3; its message lists the round's other fixes)

#### Iteration 12
**Reviewer model:** sonnet
- [WARNING] engine/backupupload.js - ENETDOWN, ENETUNREACH and EHOSTUNREACH are not pre-connect (they can end a socket after the body left), so an attempt ending that way may have written the chunk and names it unsure; red-checked. --> FIXED (commit e0d13221c; its message lists the round's other fixes)

#### Iteration 13
**Reviewer model:** opus
- [WARNING] engine/backupupload.js - A path-style S3 host takes the first path segment as the bucket: such urls must be one bucket segment and the key (a bare key path would store another object). Website endpoints refused; the header names the host pin. Both red-checked (the website mutant first broke its own syntax and was rerun). --> FIXED (commit bfbb08922; its message lists the round's other fixes)

#### Iteration 14
**Reviewer model:** sonnet
- [WARNING] engine/backupupload.js - A url lasting under a minute is refused (it would spend allowance with no time to send). --> FIXED (commit 6c71e4cf5; its message lists the round's other fixes)

#### Iteration 15
**Reviewer model:** opus
- [BLOCKER] engine/backupupload.js - BLOCKER: allowHttpForTests is registered in engine.reachable's SEAMS_5548 (it is a test seam; the guard failed on this branch). --> FIXED (commit 912ed56ef; its message lists the round's other fixes)

#### Iteration 16
**Reviewer model:** sonnet
- [NIT] five NITs (listed under Deferred above) --> DEFERRED
- No BLOCKER, WARNING or CONVENTION: converged.

### Not reviewed as its own round
- b584ec228: one classified row each in engine/win32-separator-guard.test.js and engine/windows-coupling-audit-1732.test.js for backupupload.js's split of X-Amz-SignedHeaders on ';' (a SigV4 header list, not a path list). Found by the Mortals full suite after convergence: the guards were run in round 1, before that line existed. Test-only, inside the validated hash.
