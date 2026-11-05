---
pre_challenge: true
method: challenge-loop
branch: filewho-7989
diff_hash: b736aebb0e9b53b7d3428e5a91be9131bc92c5452b333cda066c2995f062b4f5
validation: passed
subdir_audit: passed
timestamp: 2026-11-05T03:16:49Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No by the letter (round 8 found 2 WARNINGs, both fixed), stopped at the 8-round cap with no BLOCKER open. Round 7 had found 0 BLOCKERs and 0 WARNINGs on the Mac half; round 8 reviewed the Windows half, added after full validation went red on the verbs-parity guard.
**Total findings:** 23 WARNINGs, 0 BLOCKERs, plus NITs
**Fixed:** 23 | **Deferred:** 0 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, several NITs
**Self-generated:** 0
- [WARNING] engine/filewriters.js - a folder read as a gone file --> FIXED (because: 'folder'; e9690b082b)
- [WARNING] engine/filewhoview.js - "before" claimed the file unchanged --> FIXED (e9690b082b)
- [WARNING] engine/filewhoview.js - no record asserted a person --> FIXED (e9690b082b)
- [WARNING] server.js - route had no read guard --> FIXED (crossSiteRead; e9690b082b, d712c8a232)

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 4 NITs
**Self-generated:** 0
- [WARNING] engine/filewriters.js - a project made inside another's folder hid the outer record --> FIXED (every enclosing record; cb2f9d3e66)
- [WARNING] engine/filewhoview.js - "after" ruled out the recorded agent --> FIXED (cb2f9d3e66)
- [WARNING] tests - no nested, link, .. or 403 coverage --> FIXED (cb2f9d3e66)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 5 NITs
**Self-generated:** 0
- [WARNING] engine/filewriters.js - owner shown was not the one notices use --> FIXED (deepest own entry; d57130eefd)
- [WARNING] install/kosmos - refusal advised a -- that fails --> FIXED (d57130eefd)

#### Iteration 4
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 3 NITs
**Self-generated:** 0
- [WARNING] server.js - a token-only agent was refused --> FIXED (AGENT_TOKEN_ROUTES, GET only; 7c29caeb5e)
- [WARNING] engine/filewhoview.js - no record left out an unseen agent --> FIXED (7c29caeb5e)
- [WARNING] engine/filewhoview.js - "Owner: none" gave an unsupported cause --> FIXED (7c29caeb5e)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 4 NITs
**Self-generated:** 0
- [WARNING] install/kosmos - an older board's words sent agents to kosmos open --> FIXED (3eaf62b28a)
- [WARNING] engine/filewhoview.js - "outside" misled a sandboxed agent --> FIXED (3eaf62b28a)
- [WARNING] engine/filewriters.js - a network-mount path resolved on the board's thread --> FIXED (3eaf62b28a)
- [WARNING] engine/filewhoview.js - a dangling link read as a pipe --> FIXED (3eaf62b28a)

#### Iteration 6
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 2 NITs
**Self-generated:** 2 (the 403 advice and the mount check were round 5 regressions)
- [WARNING] install/kosmos - every 403 blamed on board age --> FIXED (probe overview with the same token; ad7a628a66)
- [WARNING] engine/filewriters.js - mount check missed linked project folders --> FIXED (ad7a628a66)
- [WARNING] engine/filewriters.js - a parent folder swapped mid-call --> FIXED (ad7a628a66, 90925e217a)
- [WARNING] engine/filewriters.js - Windows \\?\ paths always outside --> FIXED (ad7a628a66)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 4 NITs
**Self-generated:** 0
- [NIT] check order window --> FIXED (before and after; 90925e217a)
- [NIT] failed re-resolve read as gone --> FIXED (90925e217a)
- [NIT] lapsed owner, quiet direction --> REWORDED comment (90925e217a)
- [NIT] boot volume's /Volumes spelling --> ACCEPTED (partial by design, stated)

#### Iteration 8
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 3 NITs (the Windows half, tools/windows/kosmos-cli.js)
**Self-generated:** 0
- [WARNING] tools/windows/kosmos-cli.js - the 403 probe ran without an agent token --> FIXED (9a1a911035)
- [WARNING] tools/windows/kosmos-cli.js - ctx.pathRules ignored, so Windows path rules untested --> FIXED (9a1a911035)
- [NIT] lone surrogate crashed --> FIXED; [NIT] ./-name hint --> FIXED; [NIT] stderr vs stdout --> ACCEPTED (the file's convention, as projectRead)

### Mutations proven red
37 mutations across engine, view, route and both CLIs, each turned a test red; one (HEAD admitted on the route) stays green because the agent-token gate refuses a HEAD first, stated in the test.
