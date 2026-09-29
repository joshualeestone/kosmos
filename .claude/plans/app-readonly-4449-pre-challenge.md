---
pre_challenge: true
method: challenge-loop
branch: app-readonly-4449
diff_hash: be25f43dfcde8ea661bffab2ade9530c9e658af8c6da95ebeb01911c94b5bb4b
validation: passed
subdir_audit: passed
timestamp: 2026-09-29T03:35:01Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes, at iteration 2
**Total findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 7 NITs
**Resolved:** all 3 WARNINGs fixed (one by a decided rollout change, follow-up #4455); the CONVENTION answered on the
card; NITs fixed. **Asked (awaiting user):** 0

Validation: `yarn test` via validation-log, gated on tools/heavy-gate.sh --twice, PASSED at f2ec1e9c5: 11481
tests, 11316 pass, 0 fail, 165 skipped. test-install (heavy-gate --quiet-box): 339 passed, all 5 #4449 checks pass;
its 1 FAIL ("real /Applications unchanged") was the live 0.7.07 self-update refreshing /Applications/Kosmos.app
during the run (21:57 local), not this installer (sandboxed KOSMOS_APP_DIR); both control runs passed that check.
Controls: no read-only step -> the 4 read-only checks FAIL; no lift before the swap -> "update exits 0" and 5 more
FAIL. Subdir CLAUDE.md audit: passed. Measurement first (Liu Kang m2737): posted on the card before building.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] an installer from before this change (rollback, cached /setup) cannot remove a read-only app; its update dies with the board paused --> FIXED by decision: read-only OFF by default this release (KOSMOS_READONLY_APP=1), lifting shipped now, #4455 flips it
- [WARNING] a read-only source tree (KOSMOS_SRC) would leave the install with no app --> FIXED (stage made writable)
- [WARNING] the doctrine read as refusing a legitimate update --> FIXED (updating is fine; "wherever it is installed")
- [CONVENTION] installer built before the update measurement --> ANSWERED on the card; the live 0.7.07 update since measured and posted
- [NIT] bundle copies inherit read-only modes --> FIXED (755/644)
- [NIT] clean-machine cleanup --> FIXED (lift first)
- [NIT] the edit check tested the mode bit --> FIXED (an editor-style write-beside-then-rename check)
- [NIT] Windows agents had no folder to recognise --> FIXED (wording)
- [NIT] ACLs --> FIXED (comment: mode bits only)

#### Iteration 2
**Reviewer model:** sonnet
- [NIT] the icon chmod was safe only by context --> FIXED (own || true)
- [NIT] the probe update's switch was undocumented --> FIXED (comment)
**Converged:** no BLOCKER, WARNING or CONVENTION findings.

### Final Ledger

| # | Iter | Category | Description | Status | Resolution |
|---|------|----------|-------------|--------|------------|
| 1 | 1 | WARNING | older installer cannot lift a read-only app | FIXED | off by default; #4455 |
| 2 | 1 | WARNING | read-only source stage | FIXED | b28a9367d |
| 3 | 1 | WARNING | doctrine refuses updating | FIXED | b28a9367d |
| 4 | 1 | CONVENTION | update measurement pending | ANSWERED | card comments |

### Strengths
- Measured before building: no runtime writer under app/, the updater is the only one, and read-only folders (not files) are what stop an editor
- Controls show each half of the installer change is what the tests catch
