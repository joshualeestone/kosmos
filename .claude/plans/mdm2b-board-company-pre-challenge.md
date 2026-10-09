---
pre_challenge: true
method: challenge-loop
branch: mdm2b-board-company
diff_hash: 2ec154484ce1706beaa4f1705084cb30a2638985585f769ced1d35279fa80065
validation: rebased onto origin/main 90c64b981 (head 78cccbf46 before the plan commit): engine/remote.test.js 187/187, server.test.js 356/356 (whole file, exit 0), the guards fixture-discipline, no-brand-refs-1881, no-name-refs-3071, tool-guard-4326, all-node-tests-considered-1934, every-test-runs and no-phone-home-4253 57/57. Each review fix has a mutant control measured to fail without it (rounds 5, 6, 7, 8 and 10). No page uses the routes yet, so no browser check applies. The PR's CI runs the whole suite.
subdir_audit: passed
timestamp: 2026-10-09T03:23:50Z
iterations: 11
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 11 (blind rounds alternating Opus and Sonnet)
**Converged:** Yes (round 11, Sonnet: no WARNING or BLOCKER; one NIT accepted)

Rounds 1-10 each found WARNINGs, all fixed with tests; the commit for each round names what it fixed
(git log origin/main..HEAD). Round 11 NIT accepted: an unparseable company-status answer keeps polling until the
local clock ends the setup (bounded; a tunnel that answers in a shape this version does not know is an older/newer
mismatch the page will show as expiry).

### Per-Iteration Breakdown (every finding below was a WARNING and was FIXED with a test, unless marked)

#### Iteration 1-4
- [WARNING] Forget and sign-out left the company setup (and its secret) alive -> FIXED
- [WARNING] two starts could race; status could run twice at once -> FIXED (single flight, keyed by setup)
- [WARNING] the approval address was not required to be https on the coordinator's origin -> FIXED
- [WARNING] start and status had no time bound -> FIXED (retireTimeoutMs)
- [WARNING] the profile's CoordinatorURL could repoint the board -> FIXED (not read)
- [WARNING] the setup lifetime and poll interval were taken unclamped from the server -> FIXED (60-3600s, 1-60s)
- [WARNING] approval gives the server's setup fresh time, the board's clock did not follow -> FIXED
- [WARNING] the second step was not passed to the tunnel; a missing match code was accepted -> FIXED
#### Iteration 5-7
- [WARNING] the clock could restart on every ready -> FIXED (once)
- [WARNING] an Off pressed during the finish was undone -> FIXED (offEpoch, as the in-app register)
- [WARNING] an older tunnel gave a meaningless error and polled forever -> FIXED (update Kosmos)
- [WARNING] a finish refused as expired kept the setup for costly retries -> FIXED
- [WARNING] success paths could clear a newer setup -> FIXED
#### Iteration 8-10
- [WARNING] the board's clock could end a setup the server still held (slow background tab) -> FIXED (120s grace)
- [WARNING] sentence matching missed refusals that already spent the grant -> FIXED (one status ask)
- [WARNING] a status poll during the finish read the spent grant as gone -> FIXED (own finish only)
- [WARNING] the reinstall shortcut could record another account's email and switch its identity on -> FIXED (changes nothing)
#### Iteration 11 (Sonnet)
- [NIT] an unparseable status answer polls until the local clock ends the setup -> accepted (bounded)
