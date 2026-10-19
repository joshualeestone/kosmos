---
pre_challenge: true
method: challenge-loop
branch: refusewhy-6149
diff_hash: 28063c340b09c360a0d93dd9cdad88d776cd0d3565fa7ee2b2ad46557a99645f
validation: passed (full validation at head e5c3132c3, 08:44 to 09:16 CDT 2026-10-14: node 20605 tests, 20362 pass, 0 fail; shell 234 of 234; the helper recorded clean under 28063c340b09, this diff)
subdir_audit: passed
timestamp: 2026-10-14T14:17:40Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 5 (0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs), plus NITs listed below
**Fixed:** 2 | **Deferred:** 3 | **Asked (awaiting user):** 0

Origin: every finding is recorded BRANCH by the fail-safe; no blame lookups were run.

`tools/test-install.sh` in full (which now plants a stale refusal record and checks an update that goes through removes it) is queued on Mortals at e5c3132c3; its result goes on the pull request before merge.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above (nothing committed by the loop yet)
- [WARNING] install/setup.sh:1435: the line that removes the record after a completed swap sits outside the extracted block, so nothing tested it --> FIXED (e5c3132c: tools/test-install.sh plants a stale record before a successful update and asserts it is gone, with a control that the plant landed)
- [WARNING] web/index.html:23901: the board gave only the person's unlock line; a system flag would loop --> FIXED (e5c3132c: the administrator's line too, as the installer prints)
- [WARNING] engine/update.js:806: a refusal is matched to an attempt by time only --> DEFERRED: accepted in the plan; closing it needs the board to pass its start stamp to setup.sh, a protocol change
- [WARNING] engine/update.refused-6149.test.js:147: the in-memory attempt path is not tested --> DEFERRED: it goes through the same lastAttemptView the tests drive; stated in the plan
- NITs taken in e5c3132c: the export comment names paths; the plan says part names, not paths; the #4455 block's header points at the record.

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above (not looked up)
- [WARNING] engine/update.js:806: an install.status stamp Date.parse cannot read would drop the reason --> DEFERRED: not an issue, checked: the shell writes $3, which is lastAttempt.startedAt, set from new Date().toISOString() (engine/update.js:1016, 1235)
**Converged**: no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | install/setup.sh:1435 | BRANCH | Record removal after a swap untested | FIXED | e5c3132c |
| 2 | 1 | WARNING | web/index.html:23901 | BRANCH | No administrator unlock line | FIXED | e5c3132c |
| 3 | 1 | WARNING | engine/update.js:806 | BRANCH | Matched by time only | DEFERRED | Accepted in the plan |
| 4 | 1 | WARNING | engine/update.refused-6149.test.js:147 | BRANCH | In-memory attempt path untested | DEFERRED | Same view; in the plan |
| 5 | 2 | WARNING | engine/update.js:806 | BRANCH | A non-ISO status stamp | DEFERRED | Checked: it is ISO |

### NITs (non-blocking, not taken)
- The locked sentence ends on a code block with no closing period (iteration 2)
- The board's wording differs slightly from the installer's (iteration 2)

### Strengths (across all iterations)
- The record is best-effort and cannot change the refusal (NORECORD, with its control).
- The reader treats damage as absence, and part names are limited to bin, app and runtime before becoming paths, so a tampered record cannot steer the unlock line.
- The Mac failed sentence with no refusal is pinned byte for byte.
