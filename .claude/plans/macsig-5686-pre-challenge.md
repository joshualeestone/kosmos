---
pre_challenge: true
method: challenge-loop
branch: macsig-5686
diff_hash: 3bcb0b6bac7b2955de65ff7c2c0c62ed96e5f76577c62e0f75d0b0f93934effb
validation: passed (Mortals, the full suite at 44bb34c475, entry hash e3937c69a639; 21252 tests, 21001 pass, 0 fail, 0 cancelled, the rest skipped). The first run at 995be1ffa failed ONE test, the #1777 guard (the new pin test branches on win32 and nothing ran it on Windows); fixed by adding it to tools/windows-tests.js ALSO, with the reachable and #1732 guards run alone first. Thirteen mutants turned the pin tests red (listed below).
subdir_audit: passed
timestamp: 2026-10-16T12:04:32Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (blind; opus, sonnet, haiku, opus)
**Converged:** Yes (iteration 4: nothing above NIT; its NITs applied in c66d7d99a2)
**Findings:** 1 BLOCKER (r1), MAJORs in r1, r2 and r3. Each round's findings, fixes and decided items are in its commit
message ("review N: ...").

Mutants proven red (each reverted, tree clean after):
- no clear on a final end; a clear on a refused Leave (clearEnrollment); no clear on a Join; no signature check; no
  pin comparison (round 0)
- the review gate removed; the settle clear removed; seen.company before the check; the tick's orgKeyRefused act;
  backupjob dropping orgKeyRefused (r1)
- any org accepted for a first pin; the settle guard removed; no record anchor (r2)
- the pin re-read before a first pin removed (r3)

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [BLOCKER] the automatic re-accept (a review enroll, no person) cleared the pin after the refresh renamed the org, so a breached coordinator could repin the Mac (probed) --> FIXED b45c746e5f (a review never clears; regression test)
- [WARNING] a join settled later did not clear another company's pin (MAJOR) --> FIXED b45c746e5f
- [WARNING] a refused company key stopped backups silently (MAJOR) --> FIXED b45c746e5f (backupjob carries orgKeyRefused; the tick says it once)
- [WARNING] the refusal named the company, so backuprun kept state for the refused pair (MINOR) --> FIXED b45c746e5f
- [WARNING] the pin bypassed the house secure writer (MINOR) --> FIXED b45c746e5f
- [NIT] a null override could disarm the check; two wording fixes --> FIXED b45c746e5f

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] with no pin, any signed (org, key) was pinned, not the joined company's (MAJOR) --> FIXED a14f990a35 (a Join writes "expect <org>"; legacy Macs anchor on the record)
- [WARNING] a join marker without an org id let the coordinator's org clear a pin (MINOR) --> FIXED a14f990a35
- [NIT] the mismatch message's advice --> FIXED a14f990a35

#### Iteration 3
**Reviewer model:** haiku
- [WARNING] org identity at first contact is the coordinator's word (two MAJORs, one residual) --> DECIDED and stated in orgkeypin.js's header (943cfba21c): the signature proves the coordinator cannot OPEN the key; which org files it is the decided first-accepted-key anchor (relay docs/coordinator-api.md)
- [WARNING] the dormant claim; an unreadable pin re-pinned at a Join; a first pin could overwrite a Join's expectation (MINOR) --> FIXED 943cfba21c
- [NIT] the review-gate comment's reason --> FIXED 943cfba21c

#### Iteration 4
**Reviewer model:** opus
- No issues found above NIT.
- [NIT] what throws; why the re-read exists; a move is a trigger --> FIXED c66d7d99a2 (the relay doc's matching line is a recorded follow-up on kosmos#5686)
