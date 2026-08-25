---
pre_challenge: true
method: challenge-loop
branch: bundle-needs-609
diff_hash: ad4d8d9dd5bb73e347a820fdc72772ca8a7a4cea39f86244d57be8b9a7958529
subdir_audit: passed
timestamp: 2026-08-25T04:23:55Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (blind), then mutation controls on the last round's fixes
**Converged:** Yes (bounded: the round-3 fixes are covered by mutation controls rather than a fourth reading)
**Total findings:** 27 (0 BLOCKERs, 12 WARNINGs, 2 CONVENTIONs, 13 NITs)
**Fixed:** 20 | **Deferred:** 7

Validation: `yarn test` 2000 passed, 0 failed, every shell suite 0 failures (23:20, after 0.5.24 served); `tools/test-release-detached.sh` 48 passed, 0 failures; mutation controls (609-mutations.log): each round-3 case goes red with its guard removed from a copied lib; real-build control: the #731 shape (both codex bridge lines dropped) builds with exit 0 and the comparator names app/bin/codex-report-bridge.js, the untouched tree's real bundle passes.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 5 WARNINGs, 1 CONVENTION, 5 NITs
- [WARNING] tools/lib/release-freeze.sh - the "could not derive" guard was unfalsifiable (pinned names always printed) --> FIXED (0eb851e: refuses a tree without web/ or engine/; the comparator requires a web and an engine entry)
- [WARNING] tools/lib/release-freeze.sh - node absent or the walk throwing went silent --> FIXED (0eb851e: refusal with the reason)
- [WARNING] tools/lib/release-freeze.sh - the bin scan demanded app/bin/kosmos-tunnel, breaking the connector contract --> FIXED (0eb851e: the tunnel is the checksum argument's)
- [WARNING] tools/release.sh - the red fired only at 9b, after step 8 deployed --> FIXED (0eb851e: the comparator runs before the first copy toward the site)
- [WARNING] plan - the real-build control claimed without an artifact --> FIXED (run 22:51, transcript above)
- [CONVENTION] the comparator's doc comment orphaned above the new function --> FIXED (0eb851e)
- [NIT] second nobin.tgz name; control naming a pinned file; header text --> FIXED (0eb851e)
- [NIT] multi-line join( not seen; require('./dir') index --> DEFERRED (none in the tree; bundle.contents.test.js covers the multi-line shape)

#### Iteration 2
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 4 NITs
**Duplicates of prior findings (confirmed resolved):** 6
- [WARNING] the web/engine entry guard unfalsifiable by the suite --> FIXED (43d89ca: present-but-empty engine/ case; round 3 added the web/ case)
- [WARNING] no drop case for the pinned relocations --> FIXED (43d89ca: bin/kosmos, the hook; round 3: the icon)
- [WARNING] the bin scan keyed on join( only --> FIXED (43d89ca: resolve( too, with a case)
- [WARNING] tools/release.sh - "nothing was copied" false when 3c published the pkg --> FIXED (43d89ca: the pkg note; rc 2 gets its own headline)
- [CONVENTION] em dashes in release.sh's header --> DEFERRED (pre-existing on main)
- [NIT] walk-throws case; 9b's handling of rc 2; branch behind main; plan sentence --> FIXED in round 3 (walk case, rebase, plan) / DEFERRED (9b: unreachable, the early run came first)

#### Iteration 3
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
- [WARNING] the web half of the guard unproven --> FIXED (57b2142: empty web/ case; mutation control PASS)
- [WARNING] the bin scan read *.test.js --> FIXED (57b2142: test files excluded; mutation control PASS)
- [WARNING] plan's finished sentence one round behind --> FIXED (57b2142)
- [NIT] icon pin, tunnel exclusion, failing node, stderr in the set --> FIXED (57b2142; mutation controls PASS)
- [NIT] printf | grep -q under pipefail on a 64 KB pipe --> DEFERRED (the set is 1.4 KB)
**Converged** - the round-3 fixes proven by mutation controls; the site-restore addition (3ab60c4, Splinter's fold-in) has six cases of its own.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | release-freeze.sh | Unfalsifiable derive guard | FIXED | 0eb851e |
| 2 | 1 | WARNING | release-freeze.sh | Silent without node | FIXED | 0eb851e |
| 3 | 1 | WARNING | release-freeze.sh | Tunnel demanded of the tree | FIXED | 0eb851e |
| 4 | 1 | WARNING | release.sh | Red only after deploy | FIXED | 0eb851e |
| 5 | 2 | WARNING | release-freeze.sh | Guard unprovable | FIXED | 43d89ca, 57b2142 |
| 6 | 2 | WARNING | test-release-detached.sh | No drop case for pins | FIXED | 43d89ca, 57b2142 |
| 7 | 2 | WARNING | release-freeze.sh | join( only | FIXED | 43d89ca |
| 8 | 2 | WARNING | release.sh | False "nothing copied" | FIXED | 43d89ca |
| 9 | 3 | WARNING | release-freeze.sh | Test files scanned | FIXED | 57b2142 |
| 10 | 2 | CONVENTION | release.sh header | Em dashes, pre-existing | DEFERRED | on main |

### NITs (non-blocking, across all iterations)
- Listed under each iteration; nine fixed, four deferred with the reason.

### Strengths (across all iterations)
- The derivation run against the real tree equals the build's staged set minus the tunnel, every round (iterations 1 to 3)
- Every round's reviewer mutated a copied lib and reported which cases caught which guards (iterations 2 and 3)
- The release.sh capture under set -euo pipefail probed for rc 0, 1 and 2 (iteration 3)
