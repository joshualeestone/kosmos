---
pre_challenge: true
method: challenge-loop
branch: sw-address-3689
diff_hash: 8108b3c77c9a8379137dc3c5e9a9b9c07f691f302ee90991a67e78faf1243e5a
validation: passed (full kosmos sequence on 89c5d41b: 9102 tests, 0 failed)
subdir_audit: passed
timestamp: 2026-09-25T07:18:58Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (reviewer models: opus, sonnet, opus, sonnet)
**Converged:** Yes, at iteration 4 on HEAD 89c5d41b (no findings)
**Total findings:** 5 (0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, plus NITs)
**Fixed:** 5 | **Deferred:** 0 | **Asked (awaiting user):** 0

### Note on the rebase
Iteration 2 converged on the branch before #3696. Kano's #3696 then merged and added the agent
query to the same function (Liu Kang m679: #3696 first, this rebases onto it). The branch was
rebuilt on main b852201c as one commit (host rule first, then the query; the pre-rebase commits
are kept under the local tag backup-sw-address-3689), and the loop reopened on the rebased code.

### Per-Iteration Breakdown

#### Iteration 1 (opus, pre-rebase)
- [WARNING] web/sw.js : the comment and plan claimed the rule proves the host is one of the person's Macs --> FIXED (108d997e: it keeps a tap under the board's domain; differences from iOS named)
- [WARNING] web.sw-718.test.js : the hostile inputs no longer reached the label check --> FIXED (108d997e: the same characters carrying the domain)
- [WARNING] web/sw.js relayDomainOf : the empty-label check could not fail --> FIXED (108d997e: a trailing-dot board host tested)

#### Iteration 2 (sonnet, pre-rebase)
No findings. Converged (reopened by the rebase, see above).

#### Iteration 3 (opus, after the rebase)
- [WARNING] web/sw.js : "Kosmos-owned hosts" holds only on the Kosmos relay domain; a board on a shared domain would accept other tenants --> FIXED (89c5d41b: claim narrowed; named as a known limit in the comment and plan)
- [WARNING] docs/browser-checks/README.md : the render-push-718 row still described the Mac click-through --> FIXED (89c5d41b)
- NITs taken: non-ASCII refused before lowercasing, as iOS does (Kelvin sign test); the trailing-dot case named; the older hostile test says what it proves; the plan paragraph moved to Decisions.

#### Iteration 4 (sonnet)
No findings. **Converged.**

### Measured
- node --test web.sw-718.test.js: 16/16.
- Mutations on the rebased code (each turned the tests red): the old shape-only rule (4), punycode (1), the IPv4 check (1), the three-label floor (1), the dot boundary (1), case folding (1), the empty-label check (1), the label character set (1), the session query dropped (5), the ASCII guard (1).
- Browser check render-push-718, frozen at the commits: on main (ef58032d) the worker opened https://study.kosmos.example/ for the 127.0.0.1 board; on this change (34eb1912 pre-rebase, c5150d73 after) it opens `/`. 18/18 checks each run.

### Strengths (across iterations)
- The label rule is the iOS app's, with the two differences named
- The host is decided before the agent query, and both combinations are tested
- Every refusal falls back to this board, never a guessed host
