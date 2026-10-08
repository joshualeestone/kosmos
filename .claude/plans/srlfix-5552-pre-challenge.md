---
pre_challenge: true
method: challenge-loop
branch: srlfix-5552
diff_hash: 43b6eaa940977bf88bba3731c8dec036552daffe751e291073ec9d2d36ae9191
validation: passed (the changed test, run with LibreSSL first on PATH, both arms)
subdir_audit: passed
timestamp: 2026-10-08T04:20:18Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (sonnet, then opus)
**Converged:** Yes (iteration 2 raised NITs only)
**Fixed:** 1 WARNING and 3 NITs | **Deferred:** 1 NIT (documented) | **Asked:** 0

Validation: the change is one openssl flag and one assertion in tools/test-tunnel-handshake-gate.sh. Run with
/usr/bin/openssl (LibreSSL 3.3.6) first on PATH and TMPDIR in a fresh folder whose path has a dot: 57 passed, 0
failed, no .srl anywhere outside the test's own folder. Control (the flag removed): the test still passed 57 before
the new assertion and left <first-dot-prefix>.srl outside; with the assertion it now exits 1 on that line. The
reviewer measured Homebrew OpenSSL 3.6.3 the same way (CI shell shards are macOS only, so CI never runs OpenSSL 3
here). No full-suite Mortals run: no other file changed, and the CI shell shard runs exactly this script.

ITER_COMMITS: 43fe8cf63 bc2e77e80

### Per-Iteration Breakdown

#### Iteration 1 (sonnet)
- [WARNING] plan "weakest premise" said the Linux shard runs this file, so CI checks OpenSSL 3; linux.yml runs node only --> FIXED (plan says CI does not; OpenSSL 3.6.3 measured locally)
- [NIT] nothing in the script guards against the leak returning --> FIXED (asserts $W/ca.srl exists; mutation: dropping -CAserial makes it exit 1)
- [NIT] comment named tunnelgate-test.srl as the only possible leak; it lands at the first dot in the whole path --> FIXED
- [STRENGTH] one flag, fixed at the source, no allowlist entry; measured on LibreSSL and OpenSSL 3

#### Iteration 2 (opus)
- [NIT] the failure message said "so it leaked" though the check only knows the file is missing from $W --> FIXED (message says where it was expected)
- [NIT] the plan's grep listed .sh/.js/.mjs; the reviewer widened to .yml/.py and found none --> FIXED (plan says so)
- [NIT] an openssl writing the serial in both places would pass the in-test check --> DEFERRED (the suite-wide #4273 leak check still catches it; no known build does this)
- [STRENGTH] -CAcreateserial with -CAserial works whether or not the file exists, on both builds; the EXIT trap still cleans up on the new early exit
