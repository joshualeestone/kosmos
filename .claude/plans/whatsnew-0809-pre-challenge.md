---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0809
diff_hash: 88ecc6c8f36956e926179340061b7e6f450819b09685e84a79d738fd0d050303
validation: passed
subdir_audit: passed
timestamp: 2026-11-18T01:16:47Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes. Iteration 3 raised no BLOCKER, WARNING or CONVENTION; one of its two NITs was applied (18c9a1e732).
**Total findings:** 2 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, plus NITs
**Fixed:** 6 | **Deferred:** 0 | **Asked (awaiting user):** 0

Validation: full suite passed on Mortals on the final data (18c9a1e73, validation-log PASSED, hash 88ecc6c8f369, status clean): 29,643 node tests, 0 fail, 0 cancelled; shell shards 1/4 to 4/4 all passed; build. tools/whats-new-check.js 0.8.09: 5 highlights (mac 5, windows 4).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 2 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
- [BLOCKER] PDF pages are Mac only (engine/pdfpages.js available() is darwin) --> FIXED (914299d68c, tagged mac)
- [BLOCKER] the Files folder line claimed the page lists an empty Files --> FIXED (914299d68c)
- [WARNING] GPT-6 line without the account condition --> FIXED (914299d68c)
- [WARNING] GPT-6 since 0.8.08 misdates the Windows notes --> FIXED (914299d68c, since 0.8.09)
- [WARNING] link preview "appears once" --> FIXED (914299d68c)
- [NIT] x3: 2 fixed, 1 left (leftover-delete line untagged)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 5 NITs
- [WARNING] a connected agent gets no Files folder --> FIXED (dcf051417f)
- [NIT] x5: 2 fixed, 3 left (recorded in the plan)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
- [NIT] GPT-6 updates only the Codex Kosmos installed --> FIXED (18c9a1e732)
- [NIT] restart-wait notes line is Claude agents only --> LEFT (matches the #8548 line)
