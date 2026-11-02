---
pre_challenge: true
method: challenge-loop
branch: keyrecord-7753
diff_hash: 944c020452039d42b7cdd5bb17239502294d408d51b6f7f44430aed798638f7b
validation: passed
subdir_audit: passed
timestamp: 2026-11-02T01:14:38Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes
**Total findings:** 28 (0 BLOCKERs, 13 WARNINGs, 1 CONVENTION, 14 NITs)
**Fixed:** 13 actionable (plus NITs acted on) | **Deferred:** 1 (with evidence) | **Asked (awaiting user):** 0

Outside the validation helper, each round: the 7753, 5744, orgkeypin-5686 and backupdevicekey-5535 suites plus engine.reachable, fixture-discipline and no-name-refs (110 of 110 by the end), and a red control re-measured each round: signing epoch + 1 on purpose fails the signature tests (3 of 8 at the end).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/backupmemberkey.js:142 - crypto.sign outside any try, and a public KeyObject passed the type check, so a failure to sign blocked registration --> FIXED (feea6d1b), red control measured
- [WARNING] engine/backupmemberkey.js:167 - the default device-key wiring was untested --> FIXED (feea6d1b): a test against the sandbox's own state folder; red control measured
- [WARNING] plan:14 - "each call re-signs" is false: a registered epoch is answered from disk --> FIXED (feea6d1b): plan and card corrected, the re-send named as follow-up
- [WARNING] plan:10 - a stripped signature is a silent downgrade --> FIXED (feea6d1b): cutover rule recorded for escrowd; Renet Tilley took it (per-member ratchet plus a global cutover)
- [WARNING] plan:3 - the personal key path is unsigned --> FIXED (feea6d1b): scoped, unsigned on purpose
- [NIT] engine/backupmemberkey.js:123 - "two admins" uncited --> acted on (feea6d1b)
- [NIT] engine/backupmemberkey-5744.test.js:17 - could read a real key --> acted on (feea6d1b)
- [NIT] engine/backupmemberkey.js:138 - no reason for an unsigned registration --> acted on in iteration 2

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (signRecord's swallowed causes, in lines this loop wrote)
- [WARNING] engine/backupmemberkey.js:signRecord - every cause looked the same --> FIXED (da13e440): unsignedBecause, one fixed sentence per cause
- [WARNING] engine/backupmemberkey.js:memberKeyRecordBytes - u16 length not tied to ID_RE --> FIXED (da13e440): refused over 65535
- [WARNING] engine/backupmemberkey.js:register - the wrap is not bound --> FIXED (da13e440): plan states why, citing escrowcore.rs open_member_wrap (read, lines 72 and 90)
- [WARNING] plan - dependent work could be lost --> FIXED (da13e440): it stays on #7753, which stays open
- [NIT] retry read, single bit flip --> acted on (da13e440)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 5 NITs
**Self-generated:** 2 of the above (the unsignedBecause comment and plan line this loop wrote)
- [WARNING] engine/backupmemberkey.js:251 - the comment claimed a screen flags unsignedBecause; nothing reads it --> FIXED (540f17ee): claim deleted
- [WARNING] plan:15 - the same claim in the plan --> FIXED (540f17ee): local-only, follow-up named; Renet told
- [CONVENTION] engine/backupdevicekey.js:8 - the third use of the key was not listed --> FIXED (540f17ee)
- [NIT] engine/orgkeypin-5686.test.js:19 - could read a real key --> acted on (540f17ee)
- [NIT] plan:6 - stale test count --> acted on (540f17ee)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above (the retry comment)
- [WARNING] engine/backupmemberkey.js:166 - unproven that the tunnel passes the new field --> DEFERRED with evidence: check_mac_request (kosmos-relay crates/tunnel/src/coordinator.rs:744) checks only a JSON object under 64 KiB; the longest signed body measured 301 bytes; the personal path already sends extra fields on this route. Recorded in the plan (399a188f)
- [WARNING] engine/backupmemberkey.js:149 - the retry read is immediate --> FIXED (399a188f): stated as best effort
- [NIT] wrap, spread style, test comment --> acted on (399a188f, 810fd2d5)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/backupmemberkey.js:142 | BRANCH | a failed sign blocked registration | FIXED | feea6d1b |
| 2 | 1 | WARNING | engine/backupmemberkey.js:167 | BRANCH | default wiring untested | FIXED | feea6d1b |
| 3 | 1 | WARNING | .claude/plans/keyrecord-7753.md:14 | BRANCH | registered epochs never re-signed | FIXED | feea6d1b |
| 4 | 1 | WARNING | .claude/plans/keyrecord-7753.md:10 | BRANCH | silent downgrade by stripping | FIXED | feea6d1b |
| 5 | 1 | WARNING | .claude/plans/keyrecord-7753.md:3 | BRANCH | personal path out of scope | FIXED | feea6d1b |
| 6 | 2 | WARNING | engine/backupmemberkey.js:signRecord | SELF | causes indistinguishable | FIXED | da13e440 |
| 7 | 2 | WARNING | engine/backupmemberkey.js:memberKeyRecordBytes | BRANCH | u16 length untied | FIXED | da13e440 |
| 8 | 2 | WARNING | engine/backupmemberkey.js:register | BRANCH | wrap unbound, unexplained | FIXED | da13e440 |
| 9 | 2 | WARNING | .claude/plans/keyrecord-7753.md | BRANCH | dependent work not tracked | FIXED | da13e440 |
| 10 | 3 | WARNING | engine/backupmemberkey.js:251 | SELF | unsignedBecause overclaimed | FIXED | 540f17ee (claim deleted) |
| 11 | 3 | WARNING | .claude/plans/keyrecord-7753.md:15 | SELF | same, in the plan | FIXED | 540f17ee |
| 12 | 3 | CONVENTION | engine/backupdevicekey.js:8 | BRANCH | third key use unlisted | FIXED | 540f17ee |
| 13 | 4 | WARNING | engine/backupmemberkey.js:166 | BRANCH | tunnel pass-through unproven | DEFERRED | measured: JSON object under 64 KiB, 301 bytes |
| 14 | 4 | WARNING | engine/backupmemberkey.js:149 | SELF | retry immediate | FIXED | 399a188f |

### Outstanding questions (ASKED, still unresolved when the run ended)
- none

### NITs (non-blocking, across all iterations)
- [NIT] engine/backupmemberkey.js:157 - the "could not be signed" cause has no test; defensive (iterations 3, 5)
- [NIT] engine/backupmemberkey.js:135 - the u16 guard is unreachable while ID_RE holds (iterations 3, 4, 5)
- [NIT] engine/backupmemberkey-7753.test.js:88 - an exported AGENT_WORKFORCE_TUNNEL_STATE would red the wiring test for an environmental reason, before any write (iteration 5)
- [NIT] engine/backupmemberkey-7753.test.js - two retries in a row untested (iteration 5)
- [NIT] engine/backuprun.js:102 - its deviceKey test seam does not reach ensureMemberKey (iteration 5)

### Strengths (across all iterations)
- Domain separation: a distinct NUL-terminated tag; length-prefixed ids, fixed-width epoch and key, so the encoding is injective (iterations 1, 5)
- A failure to sign never changes registration; the fallback body is asserted by exact key set (iterations 2, 4, 5)
- The byte layout is pinned twice: hand-built from the card, and a deterministic vector shared with escrowd, rebuilt independently by Renet Tilley (88 bytes) (iterations 1, 3, 5)
- No test reads a real device key (iterations 4, 5)
- Claims about the relay checked against its code: MemberKeyReq has no deny_unknown_fields; escrowd opens wraps only against member_public (iterations 1, 3, 5)
