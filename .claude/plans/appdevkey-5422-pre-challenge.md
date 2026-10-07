---
pre_challenge: true
method: challenge-loop
branch: appdevkey-5422
diff_hash: 95187c9785e0e353d192a5379261c5878f9fc60b3550b2be81516f10965824c9
validation: passed (full typescript validation on Agent1s, attempt 3, 10:22 CDT, head 9c3bd8ced, hash 95187c9785e0, validation_rc=0 audit_rc=0; static set 29/29, surface gate OK, web/static 2590/2590 on the merged tree)
subdir_audit: passed
timestamp: 2026-10-07T15:23:35Z
iterations: 19
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 19 blind rounds alternating Sonnet (odd) and Opus (even). Iteration 19: NO NEW ISSUES.
**Scope note:** from iteration 19 the reviewer prompt scoped out scenarios needing three or more independent failures
at once unless security or money were at stake (rounds 17-18 had found only such scenarios).
**Correction disclosed:** six "mutant red" claims in iterations 2, 4, 5, 6, 10 and 11 were isolated test runs that
failed on a missing data folder (ENOENT), not on their assertions. Commit 83da99c added a beforeEach mkdir, re-ran all
six alone (pass) and mutated (five red on their own assertions; the sixth survived and got a new test).

### Per-iteration fixes (each in its commit message, "address challenge-loop iteration N")
1. no memo; exit 2 + clap words = older tunnel; past_device_ids; start re-checks cancel/busy
2. held-identity repair; verify never makes a key; clap words required
3. ownDeviceIds (pending + server allowed list); key-gone via memory; 15 s ask bound
4. key id recorded only after a taken start; no cap on past ids; server fakes as older tunnels
5. a taken verify records the key id
6. opaque id recorded only after a taken sign-in; key kept across clearHalfIdentity; Forget waits for the ask
7. owner-only folder before the first ask; keyed start records only if no cancel/Forget
8. Forget waits for a keyed start too
9. Forget's key-call wait bounded (60 s)
10. wipe skips the key file; tunnel Error line + way out; in-use from memory; malformed id replaced
11. corrupt key removed and remade on start (verify says start again); key id hidden at once
12. path scrub by the exact state folder + Caused by; Forget keeps ids; CORRECTION (see above)
13. asks one at a time; repair keeps untaken key ids; scrub every spelling; fixed spawn words; fake id from key bytes
14. past ids mirrored to memory
15. signinDeviceId reads held ids; invalid id replaced by the kept opaque id
16. idInUse() for the self-grant
17. write() folds held ids into a readable file; fixed words without an Error line
18. merged past ids; unknown id shape words; two findings declined into Known limits
19. NO NEW ISSUES
