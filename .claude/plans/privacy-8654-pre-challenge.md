---
pre_challenge: true
method: challenge-loop
branch: privacy-8654
diff_hash: f1604bdbf47a0b688cc5ba8da0c3849bbadc9a34023062dc11a4978cf6d0a781
validation: full local validation PASSED on c67000d640 on its second run (hash f1604bdbf47a; 29,500 node tests, 0 failed; shell green). The first run failed one unrelated timing test (tools.win-publish-node-bounded-7951: pwsh took 15.9 s to stop after SIGINT on a loaded machine), which passed alone. ios.privacy-manifest-7352.test.js 7/7; every new rule red on a perturbed manifest or label (measured).
subdir_audit: not run (no CLAUDE.md in the diff)
timestamp: 2026-11-17T21:55:46Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4, blind, whole branch each (opus, sonnet, opus, sonnet).
**Converged:** Yes, at iteration 4.

#### Iteration 1 (opus): 2 SHOULD-FIX, fixed in 5eb983bcf1
- the test passed with a misnamed purposes key and with a label row it could not read: the manifest is now parsed as a plist, every key checked by name, every label row must be read, types checked against Apple's list
#### Iteration 2 (sonnet): 1 SHOULD-FIX, fixed in e10d7a7bab
- the reader skipped unknown tags (an <integer> in an array passed): every tag it does not know now refuses
#### Iteration 3 (opus): 3 SHOULD-FIX, fixed in 2d26e43830
- purposes were hard-coded, not read per label row; a row could say "not linked" unseen; stray text between tags passed (Apple's reader refuses it): all now fail
#### Iteration 4 (sonnet): CONVERGED
- NITs taken in c67000d640: Apple's odd spellings (Photos or Videos, Third-Party and Developer's Advertising, Other Purposes) map to its constants
