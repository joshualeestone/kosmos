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

### Iteration 1 detail (what the reviewer checked, each with its result)
- [STRENGTH] HOME dependence after the export: none. curl and shasum run by absolute path; awk, sed, cmp need no HOME.
- [STRENGTH] The mktemp, the first python server start and its port poll all run before the export, unchanged.
- [STRENGTH] The ARM 4 flip origin and the CONTROL server are plain http.server / BaseHTTPRequestHandler, no HOME use.
- [STRENGTH] node resolves to the Homebrew binary, not a HOME-resolving shim (volta, nvm).
- [STRENGTH] The EXIT trap's rm -rf "$T" uses no HOME.
- [STRENGTH] Every invocation of the lifted block is covered: run_arm, ARM 4, CONTROL #4319 (and its exec-restored copy).
- [STRENGTH] ARM_HOME still overrides only for arms 5, which point at the fake $T/ihome install.
- [STRENGTH] The guard's decoy has runtime/bin/node, a package.json at 9.9.9 and the repo's manifest-verify.js.
- [STRENGTH] The guard asserts the decoy contains run-setup, so a decoy that would not hand off fails loudly.
- [STRENGTH] The guard asserts exit 0 AND the "all checks passed" line.
- [STRENGTH] Timeouts (230s spawn, 240s test) are generous against a ~3s shell test.
- [STRENGTH] tools/run-tests.sh line 524 globs root *.test.js, so the guard runs in the suite.
- [STRENGTH] package.json test:shell still runs bash tools/test-pkg-checksum-1670.sh.
- [NIT] none material.
