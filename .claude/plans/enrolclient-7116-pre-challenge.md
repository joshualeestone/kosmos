---
pre_challenge: true
method: challenge-loop
branch: enrolclient-7116
diff_hash: 4363b76ecfc2299004170a833249aadb0015fea9a0de636b717eaf6addfffc69
validation: passed (Mortals)
subdir_audit: passed
timestamp: 2026-11-19T19:54:13Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes: round 4 raised NITs only (5); three applied as comments and doc, two left with reasons.
**Total findings:** 11 actionable (0 BLOCKERs, 10 WARNINGs, 1 CONVENTION), 12 NITs, from the four reviewers' reports
**Fixed:** 8 in code or tests | **Asked of step 1 (escrowd, #7116):** 3 (the submission's wire format; a cross-side fingerprint and join-code vector; each admin signature verified under its registered key) | **Asked (awaiting user):** 0

Validation: passed on Mortals through mortals-validate.sh at 303ba8229 (29939 tests, 0 failed; shell shards 83, 75, 78, 80 all green), "status":"clean", hash 4363b76ecfc2, equal to this worktree's.

Bytes: seadmin.encodeDevkeyEnrol reproduces escrowd's pinned bytes.devkeyEnrol (kosmos-relay sealkey-8733 99c68c7c6); round 4 found that vector unchanged at the branch's then-latest commit. Held before the PR: the vector re-checked against sealkey-8733 once it is on GitHub.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 2 NITs
- [WARNING] the inviter check was skipped silently when no join code was passed --> FIXED: sign() takes the signing admin's id and refuses an unchecked inviter
- [WARNING] no test for the right tag with another code's hash --> FIXED
- [WARNING] the submission's encodings are a guess --> ASKED on #7116; marked unconfirmed in the header
- [WARNING] K's fingerprint has no cross-side vector --> ASKED on #7116; definition posted; recomputed from its definition in a test
- NITs: the Mac checks its own join code; a malformed code refuses --> FIXED

#### Iteration 2
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 2 NITs
- [WARNING] the checked admin id was not tied to the id posted --> FIXED: sign() returns { adminId, sig } for an enrolment, the shape submission() takes
- [WARNING] the fingerprint tag is outside escrowd's tag test --> ASKED on #7116 (ALL_TAGS and a pinned vector)
- [CONVENTION] a header line past the wrap --> FIXED; NIT: a signature that is not bytes --> FIXED

#### Iteration 3
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 3 NITs
- [WARNING] the PR before the relay branch is pushed --> HELD (above)
- [WARNING] adminId is not tied to expectedKey on this Mac --> STATED: escrowd verifies each signature under its admin's key (asked on #7116)
- [WARNING] the 32-byte checks were untested --> FIXED (31 and 33 bytes for each field)
- [WARNING] an empty inviter was accepted --> FIXED (empty company, member or inviter refuse)
- NITs: a join code with another action refuses; the unchecked error stops guessing; the plan's count --> FIXED

#### Iteration 4
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 5 NITs
- sign()'s two return shapes documented; the caller slice's second-admin rule and deviceSign's required code noted --> FIXED (comments)
- the join code hash and tag cross-side --> ASKED on #7116; the nonce's length --> NO CHANGE (escrowd checks it, as for every action)
