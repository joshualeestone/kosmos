---
pre_challenge: true
method: challenge-loop
branch: standing-3889
diff_hash: b664c95d4eae07dac1c5ea02ee498eb9d39f4c32c9d0a130369fe1bae59cd734
subdir_audit: passed
timestamp: 2026-09-26T10:41:05Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1: a one-line fix scoped on the card at 23:25, re-read against the merged #3911 code, and measured with a perturbation.
**Converged:** Yes.

## Iteration 1
- [STRENGTH] Root cause, confirmed on current main:
  - `setupRun` never sets `.data`, and the real `kosmos-tunnel setup complete` prints no JSON ("registered. address: ...", setup.rs 201/203), so `if (result.ok && result.data ...) fedSetStanding(...)` never ran.
  - #3911 (merged) now clears a new identity's standing to '' through fedSetStanding, which stamps standing_at as FRESH. So the poll's refreshStandingIfStale would not re-ask for a whole TTL, not "one poll" as I scoped it last night. The fix covers both.
- [STRENGTH] The fix is `refreshStandingIfStale({ ttlMs: 0 })` after a successful setup, not awaited. That helper is single-flighted, never throws, and returns early unless enrolled. The setup answer does not wait on a second network call.
- [STRENGTH] Test: after the Settings setup (`setupComplete('123456', 'Hers')`), the cached standing is 'good' (the fake tunnel's mac-request answers good). Perturbation: without the line, exactly that test fails. Restored from a backup and verified with cmp.
- [WARNING] It broke one existing test: #648 read `recorded()[0]` after a setup, and the non-blocking standing request can be recorded first. Fixed with the file's own idiom (find the call by its verb, as lines 401/576/718 do), not by awaiting in production. Other `recorded()[0]` users were checked: line 370 is before any setup, so it is unaffected.
- [NIT] The standing request adds one signed `mac-request` per successful Settings setup, the same call the TTL poll already makes.
- [CONVENTION] No em dashes added. remote*.test.js and mac-standing*.test.js pass 130/130.

## Weakest premise
- That nothing else counts or orders tunnel calls right after a Settings setup in a way the full suite would catch. CI runs the full suite on the PR.
