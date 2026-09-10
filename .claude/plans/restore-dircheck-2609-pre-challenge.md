---
pre_challenge: true
method: challenge-loop
branch: restore-dircheck-2609
diff_hash: 124f57d81fcacb3c954bbdd389b8e61e3511afbd88d8caa7d3427fc9b91b6d80
validation: passed
subdir_audit: passed
timestamp: 2026-09-10T02:04:43Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes
**Total findings:** 9 (0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 6 NITs)
**Fixed:** 9 | **Deferred:** 0 | **Asked:** 0

Every WARNING was about SCOPE/EDGE/IDIOM precision (Mac-only scope, readJob/existsSync
case-insensitivity, the platform guard idiom) -- the core fix (refuse restore when the account dir
is gone, running nothing) was praised in all four passes. Reviewers ran the tests each pass and
confirmed the worktree/behaviour. Witnessed by Opus (1,3) + Sonnet (2,4).

### Per-Iteration Breakdown

#### Iteration 1 (opus)
0 BLOCKERs, 1 WARNING, 2 NITs. **Self-generated:** 0.
- [WARNING] check is MAC-ONLY (reads the plist; win32 has no plist) but the scope comment implied the class was closed --> FIXED (0df37920): state Mac-only + name the win32 follow-up.
- [NIT] fires regardless of record.label --> FIXED (0df37920): documented as intended.

#### Iteration 2 (sonnet)
0 BLOCKERs, 1 WARNING, 2 NITs. **Self-generated:** 0.
- [WARNING] readJob's plist read is case-insensitive on macOS (a hand-deleted plist + a live case-variant sibling could read a stranger's job) --> FIXED (b0a70c8e): acknowledged in-comment (consistent with sibling startableGone, no stricter); added explicit win32 guard.
- [NIT] existsSync calls a path-now-a-file present --> documented. [NIT] MAC-only was incidental --> made structural via a `platform` guard.

#### Iteration 3 (opus)
0 BLOCKERs, 1 WARNING, 1 NIT. **Self-generated:** 1 (the WARNING targets the iter-2 guard).
- [WARNING] the iter-2 guard `platform === 'win32'` diverged from the file idiom and left the production path (undefined platform) still incidental, contradicting the "structural" claim --> FIXED (bc5cf8dc): `(platform || process.platform) === 'win32'`.
- [NIT] test leaked a tmp dir --> FIXED (bc5cf8dc): account dir under SANDBOX.

#### Iteration 4 (sonnet)
0 BLOCKERs, 0 WARNINGs, 1 NIT. **Self-generated:** 1 (stale comment referencing the old guard form).
**Converged** -- no actionable findings; reviewer ran 63/63 and confirmed the guard/scoping.
- [NIT] comment still named `platform === 'win32'` after the guard changed --> FIXED (c33a8906).

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/remove.js | BRANCH | Mac-only scope not stated | FIXED | 0df37920 |
| 2 | 1 | NIT | engine/remove.js | BRANCH | fires regardless of label (intended) | FIXED | 0df37920 |
| 3 | 2 | WARNING | engine/remove.js | BRANCH | readJob case-insensitivity edge | FIXED | b0a70c8e |
| 4 | 2 | NIT | engine/remove.js | BRANCH | existsSync file-vs-dir | FIXED | b0a70c8e |
| 5 | 2 | NIT | engine/remove.js | BRANCH | Mac-only incidental not structural | FIXED | b0a70c8e |
| 6 | 3 | WARNING | engine/remove.js | SELF | iter-2 guard idiom wrong for undefined platform | FIXED | bc5cf8dc |
| 7 | 3 | NIT | engine/remove.test.js | BRANCH | test leaks a tmp dir | FIXED | bc5cf8dc |
| 8 | 4 | NIT | engine/remove.js | SELF | comment names the old guard form | FIXED | c33a8906 |

### Outstanding questions (ASKED)
None.

### Strengths
- Core fix correct/minimal, placed before any mutation, so REFUSE runs nothing (no re-enable of a job pointing at a deleted dir). Perturbation-verified red-capable.
- Tests load-bearing: refuse asserts no `enable` ran + stays removed; CONTROL asserts `enable` fires (no over-refuse); the fixture self-checks `readJob(name).configDir === acctDir`.
- The `(platform || process.platform) === 'win32'` guard matches the file's jobFor idiom, making the Mac-only scope structural for the production path (removal.restore passes no platform).
- Scope documented honestly: default-account, gone-plist, case-insensitivity, file-vs-dir, CASEY/casey collision, and the win32 follow-up.

### Follow-ups (not this card)
- win32: a Windows agent with a deleted account dir is still unchecked (configDir rides the Scheduled Task argv, not a plist; needs win32job configDir readback).
- Frontend: April's option 3 (grey out the Restore control on the removed list when the dir is gone).
