---
pre_challenge: true
method: challenge-loop
branch: connect-875
diff_hash: 45cac70d688c6c4d9aec8085b0cf0104593333ca7710103737acb084c33d74c9
validation: passed
subdir_audit: passed
timestamp: 2026-09-05T10:40:41Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (6.0 baseline + 2 blind review passes)
**Converged:** Yes (iterations 1 and 2 both returned zero actionable findings)
**Total findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Fixed:** 1 | **Deferred:** 1 | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1 (6.0 baseline validation)
Full pre-PR suite (node --test + shell) + subdir audit ran clean on the branch's
initial state. connect.js is widely imported, so a green full suite here is the
no-regression check.

#### Iteration 2 (first blind review) -- CONVERGED (zero actionable)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs, many STRENGTHs
- [NIT] connect.js sha256File -- synchronous read briefly blocks the event loop
  on the reuse path --> DEFERRED: acceptable, matches the file's synchronous fs
  style, fires only on the rare failure-retry path (the happy path deletes dest
  after a successful install), and is far cheaper than a re-download.
- [NIT] connect.js:~1508 -- the cancel by-path-unlink residual comment did not
  mention that #875's reuse path widens the set of successor flows it can touch
  --> FIXED (78e5a764): added a clause noting a reuse-returning successor exposes
  the same dest; consequence unchanged (honest re-download, never corruption).

#### Iteration 3 (second blind review) -- CONVERGED (zero actionable, second consecutive)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT (a re-find of the
deferred sync-hash NIT, which the reviewer itself called an acceptable tradeoff)

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 2 | NIT | engine/connect.js | sha256File sync read blocks event loop on reuse | DEFERRED | acceptable, sync-fs style, rare retry path |
| 2 | 2 | NIT | engine/connect.js | cancel-residual comment omits reuse path | FIXED | 78e5a764 |

### Strengths (across iterations)
- Reuse gate correctly ordered after the dir-owns sweep (sweep keeps only dest); hash-gated against the same lowercased `want` the post-fetch checksum uses, so stale/truncated/tampered/wrong-version files fall through to a fresh download, never install.
- sha256File is leak-free (fd closed in finally), streams a 1MB buffer, hashes only bytes read; the whole reuse block is wrapped so any read/hash/TOCTOU trouble degrades to a fresh download rather than throwing.
- Keeping the binary on install-failure is safe: single caller returns fail() immediately after; success path still deletes; cancel/no-home paths left as-is; stranding bounded by the dir-owns sweep, proven by the new-version-sweeps-old test.
- Tests carry real discriminators: reuse test's broken (500) binary endpoint proves no re-fetch; corrupted-cache control proves the hash gate is load-bearing; rewritten stuck-install test asserts the exact kept filename + byte-for-byte checksum.
- Full node --test + shell suite green (no regression across the widely-imported connect.js); no em dashes in added lines.
