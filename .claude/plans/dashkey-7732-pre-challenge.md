---
pre_challenge: true
method: challenge-loop
branch: dashkey-7732
diff_hash: 47458be18db7eba101d57d681d4608b65022767f7f56e441ac71ae52c8da729e
validation: passed
subdir_audit: passed
timestamp: 2026-11-01T09:53:57Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1. **Converged:** yes.
**Validation, stated plainly:** focused: one line of one test. The test passes whole. On the card's measured key the old form exits 2 and the new form matches.

## Iteration 1
- [NIT] (left) nothing forces a key starting with -, so the suite rarely exercises this shape. The shape was proved by hand on the measured key.

Checked: a fixed-string match finds the key wherever it sits; no other line of the test or tools/lib/service-keys-live.sh builds a pattern from a key; the assertion cannot newly pass when it should fail, and a checker not printing the key still goes red.
Not checked: the suite was not run by the reviewer, and tools/check-service-keys-live.js was not read.

## Measured by hand
- Key from the card: -HGPhkpnlDFbjnd86UnH5oiwHaAw07OZRV7YUBiAbJI.
- Old form on that key: grep: invalid option, exit 2.
- New form on that key: match, exit 0.
- tools/test-service-keys-live-7568.sh whole: ALL PASS, exit 0.

## The reviewer's reading of the rest
- The sed at lines 24 and 25 takes its pattern from fixed text; key contents are only its output.
- Keys go into JSON by printf, which is no pattern.
- The other greps in the test and the lib use fixed strings.
- LIVE_RAW is checked non-empty at line 26, so an empty pattern cannot pass.
