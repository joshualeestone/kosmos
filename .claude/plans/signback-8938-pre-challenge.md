---
pre_challenge: true
method: challenge-loop
branch: signback-8938
diff_hash: 9c3977f801e1200f28accb939dfcb79891b634044b23dfd5334d8137d0312efb
validation: passed
subdir_audit: passed
timestamp: 2026-11-23T19:34:55Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No (stopped after iteration 8 at the operator's standing cap of 8 review rounds; round 8 read the whole branch, its two warnings were decided and recorded in the plan, not changed)
**Total findings:** 46 (0 BLOCKERs, 15 WARNINGs, 0 CONVENTIONs, 23 NITs, rest strengths)
**Fixed:** 17 (warnings and nits acted on) | **Deferred:** 6 | **Asked (awaiting user):** 0

Full validation at the end (6j): validation-log PASSED for hash 9c3977f801e1, 30,738 node tests, 0 failed; subdir audit clean.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html stepUpReturnBusy: the invite return could open over other dialogs --> FIXED (dede32907d)
- [WARNING] web/index.html FEDINV_RETURN_READ: a failed projects read never retried --> FIXED (dede32907d)
- [WARNING] web/index.html fedInviteMake/pjMintInvite: forgot a Claude note too --> FIXED (dede32907d)
- [WARNING] docs/browser-checks/render-fedinvreturn-8938.js: press simulated, key never proven --> FIXED (dede32907d)
- [NIT] boot comment misplaced --> FIXED; [NIT] "foo ." trim --> FIXED; [NIT] give-up arm count --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html resumeFedInviteReturn: a late return takes the screen from someone who moved on --> FIXED (8d3b1f75bb)
- [WARNING] web/index.html: 3 failed reads end the return --> DEFERRED: today's behaviour, recorded in the plan
- [NIT] overwrite comment --> FIXED; [NIT] "one at a time" vs PJ_GEN --> no change

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above (code line, fixed normally)
- [WARNING] web/index.html fedInviteReturnTouched: closing a dialog counted as moving on --> FIXED (d143e376de)
- [WARNING] web/index.html acctAddStart: a Claude start erased an invite note --> FIXED (d143e376de)
- [NIT] second Make clears first note --> plan; [NIT] mid-list ellipsis --> FIXED; [NIT] test message --> FIXED; [NIT] surrogate slice --> no change

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (code line, fixed normally)
- [WARNING] web/index.html fedInviteReturnTouched: Escape outside first run's markup dropped the note --> FIXED (249e5e56fd)
- [WARNING] web/index.html fedInviteReturnBusy: dialogs hidden another way, or inside a hidden section --> FIXED (249e5e56fd, board's own selector)
- [NIT] Unicode ellipsis --> FIXED; [NIT] abbreviation stop --> no change; [NIT] pre-boot input --> no change

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html fedInviteReturnBusy: missed update/restart screens, dialog[open], phone menu --> FIXED (45f54f4190)
- [NIT] later reload limit --> plan; [NIT] archived project --> FIXED; [NIT] "?"/"!" stop --> FIXED; [NIT] boot TDZ if deferred --> FIXED (timer)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING (2 more were duplicates or by design), 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html fedInviteMake: forced close mid-Make writes no note --> DEFERRED: rare, recorded in the plan
- [WARNING] later reload --> duplicate of the plan's recorded limit; [WARNING] plusOrgSeesText bundled --> DEFERRED: by design (Renet's #8942 nit)
- [NIT] no browser arm for moved-on --> FIXED (b47e37b38d); [NIT] concurrent read --> no change; [NIT] removed-on-close claim --> measured (wnClose, istepClose remove)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html FEDINV_RETURN_LINE: email not carried, line claimed the sheet whole, Enter made an unbound code --> FIXED (12e7c75720, hadEmail flag, email line, focus)
- [WARNING] consolidated layout untested --> DEFERRED: recorded as a limit in the plan
- [NIT] logout-way other account --> plan; [NIT] touch scroll --> plan; [NIT] ".." --> no change; [NIT] narrow comment --> FIXED

#### Iteration 8 (whole branch)
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] Tab/touch end the return --> DEFERRED: limit (c) in the plan, the return usually acts within a second
- [WARNING] no-email focus on Make --> DEFERRED: decided in the plan, Enter makes exactly the invitation asked for
- [NIT] bundled full-stop change --> PR description says so; [NIT] stub hides fedInviteOpen --> browser check R2/R3 cover it (run, 14 PASS)

### Final Ledger

Origin was assigned by reading which commit wrote the cited code, not by the 6c-bis blame lookup, so treat it as
reasoned, not measured. Every SELF finding was on a code line and was fixed or decided normally; no prose claim was
deleted on the strength of it.

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html (stepUpReturnBusy) | BRANCH | return opens over other dialogs | FIXED | dede32907d |
| 2 | 1 | WARNING | web/index.html (FEDINV_RETURN_READ) | BRANCH | failed read never retried | FIXED | dede32907d |
| 3 | 1 | WARNING | web/index.html (fedInviteMake) | BRANCH | invite attempt erased Claude note | FIXED | dede32907d |
| 4 | 1 | WARNING | render-fedinvreturn-8938.js | BRANCH | press simulated | FIXED | dede32907d |
| 5 | 2 | WARNING | web/index.html (resumeFedInviteReturn) | BRANCH | late return over moved-on person | FIXED | 8d3b1f75bb |
| 6 | 2 | WARNING | web/index.html (reads cap) | SELF | 3 failed reads end the return | DEFERRED | plan: today's behaviour |
| 7 | 3 | WARNING | web/index.html (fedInviteReturnTouched) | SELF | closing a dialog = moved on | FIXED | d143e376de |
| 8 | 3 | WARNING | web/index.html (acctAddStart) | BRANCH | Claude start erased invite note | FIXED | d143e376de |
| 9 | 4 | WARNING | web/index.html (fedInviteReturnTouched) | SELF | Escape outside first run markup | FIXED | 249e5e56fd |
| 10 | 4 | WARNING | web/index.html (fedInviteReturnBusy) | SELF | dialog detection incomplete | FIXED | 249e5e56fd |
| 11 | 5 | WARNING | web/index.html (fedInviteReturnBusy) | SELF | missed tipModalOpen covers | FIXED | 45f54f4190 |
| 12 | 6 | WARNING | web/index.html (fedInviteMake) | BRANCH | forced close writes no note | DEFERRED | plan limit |
| 13 | 6 | WARNING | web/index.html (plusOrgSeesText) | BRANCH | bundled change | DEFERRED | by design |
| 14 | 7 | WARNING | web/index.html (FEDINV_RETURN_LINE) | BRANCH | email lost, unbound code on Enter | FIXED | 12e7c75720 |
| 15 | 7 | WARNING | render-fedinvreturn-8938.js | BRANCH | consolidated layout untested | DEFERRED | plan limit |
| 16 | 8 | WARNING | web/index.html (fedInviteReturnTouched) | SELF | Tab/touch end the return | DEFERRED | plan limit (c) |
| 17 | 8 | WARNING | web/index.html (resumeFedInviteReturn) | BRANCH | no-email focus on Make | DEFERRED | plan decision |

### Outstanding questions (ASKED, still unresolved when the run ended)
- none

### NITs (non-blocking, across all iterations)
- [NIT] web/index.html: label.slice counts UTF-16 units (iteration 3)
- [NIT] web/index.html plusOrgSeesText: an abbreviation's closing stop goes, ".." kept (iterations 4, 5, 7)
- [NIT] web/index.html: input before DOMContentLoaded is not watched (iteration 4)
- [NIT] web/index.html: the return's read can race the page's own loadProjects, harmless (iteration 6)

### Strengths (across all iterations)
- One shape check (stepUpNoteShaped) for both note kinds; marks and forgets are per kind in both directions, tested with controls (iterations 1 to 8)
- The note keeps no email and no code; tests assert the exact key set; nothing is sent on the return (iterations 1, 2, 7)
- The browser check presses the ask's real form with a real API address on the stub reply, and every control can return the dangerous answer (iterations 5, 6, 7)
