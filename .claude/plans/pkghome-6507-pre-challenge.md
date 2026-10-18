---
pre_challenge: true
method: challenge-loop
branch: pkghome-6507
diff_hash: 4fdac76476bfca8a9528ac58e2fefe6e5d494eec811096e535f0eff25e0a6af5
validation: passed
subdir_audit: passed
timestamp: 2026-10-18T20:03:03Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 blind review (sonnet), a test-only fix (#6507, red for every Mortals validation)
**Converged:** Yes (iteration 1: no BLOCKER or WARNING)
**Total findings:** 0 BLOCKERs, 0 WARNINGs, 0 material NITs
**Fixed:** n/a | **Asked (awaiting user):** 0

Validation: reproduced the Mortals failure on Agent1s with HOME = a decoy 0.7.57-style install (same 3 FAILs); with the fix, all checks passed with the decoy HOME and with the real HOME; tools.pkg-checksum-home-6507.test.js 1/1, and a mutant removing the export turns it red.

## Final ledger
### Iteration 1 (sonnet): no BLOCKER or WARNING findings (converged)
- [NIT] none material. Checked: nothing after the export reads the real HOME (curl/shasum by absolute path, http.server, Homebrew node); no remaining escape (run_arm, ARM 4, CONTROL #4319 all inherit the sandbox); the guard asserts the decoy would hand off; run-tests.sh globs root *.test.js; test:shell still runs the shell test.
