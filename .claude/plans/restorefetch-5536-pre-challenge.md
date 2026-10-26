---
method: challenge-loop
branch: restorefetch-5536
diff_hash: 102b78722d0cfdfa216a009d7223749c2d9513b954d8b266510278027362037c
timestamp: 2026-10-26T00:53:06Z
iterations: 6
converged: true
---

# Challenge-loop proof: restorefetch-5536 (kosmos#5536 slice 2)

The plan (.claude/plans/restorefetch-5536.md) records the design, each round's findings and the residuals. Each
round was one fresh blind reviewer, given the code and the route contract, not my conclusions.

#### Iteration 1 (blind review)
[BLOCKER, fixed] Expiry compared the coordinator's expires_at with this clock: 270 s fast made every URL stale.
[WARNING, fixed] Chunks planned in the objects map's order (name-sorted), not the order restore fetches.
[WARNING, fixed] A dropped grant stopped the restore as a refusal.
[WARNING, fixed] Links to any https host; now the manifest link's origin, a path ending in the key, no IP literal.
[WARNING, fixed] Timeouts the same length inside and out; a stopped restore with nothing restored reported ok.

#### Iteration 2 (blind review)
[BLOCKER, fixed] A grant that never answered hung the restore (now 15 s, and the plan under the fetch deadline).
[WARNING, fixed] Misses counted over the whole restore; the hourly-limit copy said try again; partial reported ok.

#### Iteration 3 (blind review)
[WARNING, fixed] A chunk a later file reuses spent a grant alone (short grants are topped up to 500).
[WARNING, fixed] One 503 or reset lost a file silently (one GET retry; the reason reaches fetchProblems).
[NIT, declined] Keeping a grant that answers after its cut-off: at most one call, and it would race the retry.

#### Iteration 4 (blind review)
[WARNING, fixed] The manifest (to 64 MB) shared a chunk's 40 s GET (its own single GET, 110 s worst).
[WARNING, fixed] Nothing restored without a stop still answered ok.

#### Iteration 5 (blind review)
[WARNING, fixed] A manifest lost to an outage or an expired link was unnamed.
[WARNING, documented] The reviewer route's 15-minute release window caps a reviewer restore; header and contract.

#### Iteration 6 (blind review)
No BLOCKER, no WARNING. NITs taken: a missing chunk named, 10 s of manifest margin, a re-grant skips fresh keys, a
malformed epoch's own sentence; the capped failure list stated.

### Final Ledger
- Converged at iteration 6. engine/restorefetch-5536.test.js and restorerun-5536.test.js: 28 of 28; with
  engine.reachable and comment-deferral: all pass.
- 49 mutation arms, every one red, each applied, checked applied, run, and restored (byte-compared). Hangs counted
  as red (the defect they guard). Not pinned by its own arm: the "skip fresh keys" half of the review 6 re-grant
  filter (arm R covers re-granting everything).
- Merged onto main at 8d13e18e45 (Baron's #7158 changed backupsnapshot.js): my two files plus backupsnapshot.test.js,
  131 of 131.
- Full validation at 5c21cd6894 through queued-heavy: 23970 tests, 0 fail, validation-log PASSED hash 102b78722d0c,
  matching this proof's diff_hash.
