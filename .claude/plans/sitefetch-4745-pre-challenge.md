---
pre_challenge: true
method: challenge-loop
branch: sitefetch-4745
diff_hash: be678e83d97a016969da739d983aab8242a24419370b1823848e4e1ce8931292
validation: passed (Mortals, ee5b609d7, hash be678e83d97a, 14:58 CDT)
subdir_audit: passed
timestamp: 2026-09-30T17:13:22Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (blind, sonnet, each a fresh reviewer), 2026-09-30
**Converged:** Yes (iteration 2: 0 BLOCKER, 0 WARNING, 3 NIT)
**Findings:** 0 BLOCKERs, 1 WARNING, 6 NITs | **Fixed:** 1 WARNING, 4 NITs | **Kept, with reason:** 2 NITs | **Asked:** 0

### Iteration 1: 0 BLOCKER, 1 WARNING, 3 NIT
- [WARNING] tools/deploy-site.sh skip-when-correct compared the local file with the served .sha256 only, dropping the old proof that the ARTIFACT is served --> FIXED (a one-byte ranged GET must answer 206, bytes 0-0/<local size>, one byte equal to the local first byte; otherwise the full fetch, which refuses on a 404). Measured on the live host: the real build answers bytes 0-0/52555779; a missing path ALSO answers 206, as the 8498-byte fallback page, which the size check rejects.
- [NIT] a failure between the two renames leaves a mismatched pair for microseconds --> FIXED in wording (nothing here trusts the local sidecar afterwards; verify_sha re-fetches the served one)
- [NIT] tests missed 404, empty sidecar and more --> FIXED (arms h to o)
- [NIT] a 404 is retried 3 times --> KEPT (curl -f exits 22 for a 503 too, which is worth retrying; about 4 s)
### Iteration 2: 0 BLOCKER, 0 WARNING, 3 NIT (converged)
- [NIT] the header parse read the last Content-Range across all redirect blocks --> FIXED (_final_content_range reads the final block only; arm p with saved CRLF / HTTP/1.1 / multi-block headers; the old parse reds p3, a first-block parse reds p2 and p3)
- [NIT] the first byte of every .tar.gz is 1f, so the byte check discriminates little --> KEPT (the size is the discriminator, measured; the byte only rules out a same-size different file type)
- [NIT] the parse was only exercised by stub headers --> FIXED (arm p)

### Tests
tools/test-deploy-site-fetch-4745.sh 45/45, in test:shell. The five existing deploy-site tests are unchanged (18/18/47/7/9).
