---
pre_challenge: true
method: challenge-loop
branch: ship-tunnel
diff_hash: bac1efa52aebc4d3c0effdc1ee209676804e6a26e5c8968570fc35fdf7b5e1b9
subdir_audit: passed
timestamp: 2026-08-24T19:50:05Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (planned two fixing rounds plus a convergence pass; the convergence pass found comment-only stale-doc WARNINGs of my own, so it did not converge and one more fixing-plus-confirmation round was needed, all documentation, no logic)
**Converged:** Yes (the final confirmation pass found 0 BLOCKER, 0 WARNING, 0 CONVENTION, 1 NIT, now fixed)
**Total findings:** 0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, several NITs
**Fixed:** all 5 WARNINGs and the doc NITs
**Recorded, not fixed:** the input-vs-relay checksum completeness (#609), the binary-not-checkout provenance (#621), and the release path running no real install pre-serve (#624), each a different failure class than this card.

Validation after every round and on the final commit: node suite 1857 pass, 0 fail; subdir audit 0; tree clean. Beyond the suite, the freeze-build-compare was run on the REAL repo: the bundle was built inside a frozen worktree with the actual universal binary as input, and the connector was confirmed staged, a universal x86_64 plus arm64 Mach-O in the served tarball, Developer ID signed (hardened runtime, TeamIdentifier 864QZ69GF2), able to run (it loads and prints help), and that step 9b matches the built sha, catches a wrong sha, refuses an empty sha, and fails when the connector is absent but expected. The connector's #567 device-gate code was probed present in the binary directly by strings, not inferred.

#### Iteration 1 (fixing)
[WARNING] the comparator verified the connector's checksum if present but never asserted PRESENCE, so a bundle shipped without it passed with an expected sha (the exact failure this card prevents) --> FIXED with a presence flag and a test; setup.sh's post-extract sanity list gained the connector. Plus an arch-substring NIT and a pipefail guard-reachability NIT. Developer ID signing added in-build per Splinter's ruling.

#### Iteration 2 (fixing)
[WARNING] the upper comment and the plan still said the connector arrives already signed and signing was not in this change, after the code began signing in-build --> FIXED by reconciling both. Quoted the identity in the failure message; narrowed the load-check comment.

#### Iteration 3 (convergence attempt, did not converge)
[WARNING] the plan finish line still said the connector arrives already signed; [WARNING] the arch-check comment described the wrong tool (it named the file command while the code parses lipo archs) --> both FIXED, with a full-diff sweep for the whole stale-comment class, the lesson of half-fixing a comment twice. Dropped a duplicated test comment.

#### Iteration 4 (final confirmation, converged)
No BLOCKER, WARNING, or CONVENTION. [NIT] the function-header usage line did not mention the new third argument --> FIXED, doc completion.

### STRENGTH
- Served-equals-built for the connector is proven end to end: the sha is captured after signing, re-derived from the tarball for pipefail safety, threaded into step 9b, which enforces both checksum-match and presence-when-expected; six isolated comparator test cases, none vacuous.
- Signing fails loud with no ad-hoc fallback; otool showed only system dylibs, so one codesign of the executable is correct with no inside-out pass, and the binary is run after signing to prove it loads under hardened runtime.
- The bound held on the property that matters: every finding past iteration 1 was documentation catching up to a mid-stream signing ruling, not logic; the logic was strengthened unchanged across passes 2, 3, and 4.
