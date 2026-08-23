---
pre_challenge: true
method: challenge-loop
branch: no-offer-from-source
diff_hash: 816cac75ce564a12c9a8ebd2af474e81d2ce914b91c67c6b558c33be47c26116
subdir_audit: passed
timestamp: 2026-08-23T18:08:52Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 (self-review; two lines of server and two tests, Josh waiting)
**Converged:** Yes
**Total findings:** 1 (0 BLOCKERs, 1 WARNING)
**Fixed:** 1 | **Deferred:** 0

### Iteration 1
- [WARNING] the check route's test pinned the offer from source --> FIXED (pinned null from source, the offer with an installed root as the control, `source: true`)

### What was checked
- Both places the offer is served (status payload, check route) gated on `installedRoot()`; the install route already refused from source, so the offer is now a promise the route can keep.
- The page's toast renders nothing for a null offer (`renderUpdateToast(null)` clears the slot), and the engine-stale line (#338) is the state a source-run board shows for newer code on disk.
- yarn test 1583 pass.
