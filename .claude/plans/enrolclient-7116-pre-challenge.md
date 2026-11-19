---
pre_challenge: true
method: challenge-loop
branch: enrolclient-7116
diff_hash: 47a48f4b3344911bf4452a22d7279bc27deddd49164759e23d9184bc4bcfdb39
validation: passed
subdir_audit: passed
timestamp: 2026-11-19T22:17:34Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes: round 6 raised NITs only (3), all applied. Rounds 5 and 6 reviewed the request builder rewritten after round 4 to match escrowd's devkeyhist_enrol decoder as pushed (kosmos-relay sealkey-8733 b874d078d).
**Total findings:** 12 actionable (0 BLOCKERs, 11 WARNINGs, 1 CONVENTION), 17 NITs, from the six reviewers' reports
**Fixed:** 8 in code or tests | **Asked of step 1 (escrowd, #7116):** 3 (the submission's wire format; a cross-side fingerprint and join-code vector; each admin signature verified under its registered key) | **Asked (awaiting user):** 0

Validation: the full suite at 27a24a62a3 passed on this Mac (29953 tests, 0 failed; all four shell shards green), hash 47a48f4b3344. A first local run failed only on 2 timing tests outside the change (create.test.js, restoreworld-5536.test.js), both passing alone (245/245, 66/66). The vectors file is identical to sealkey-8733 as pushed (b874d078d), re-checked before this proof.

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

#### Iteration 5
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
- [WARNING] request() did not refuse a nonce escrowd never issues (escrowd's rosternonce::LEN is 32) --> FIXED, with a 32-byte nonce in the test and a 16-byte one refused
- NITs: an entry with both a Mac and a passkey signature; a note that a refused signature can mean the roster's generation moved --> FIXED

#### Iteration 6
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
- deviceSign refuses a nonce that is not 32 bytes; the stale name 'submission'; a note that escrowd's K check is stricter than Node's --> FIXED
