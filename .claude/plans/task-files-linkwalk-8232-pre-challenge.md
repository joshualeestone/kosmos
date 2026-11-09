---
pre_challenge: true
method: challenge-loop
branch: task-files-linkwalk-8232
diff_hash: e8ec8e89f405450b67823c918428f5df8ab223057d65bc3aeb43cd79b027339c
validation: substituted (the helper needs yarn/npm, which this Windows box does not have; the repo's type-check script is a no-op. Instead, with the no-schtasks preload, at 348e447bcd: every test file naming filesLines, windrives, builtFilePath, tasklist or reachesAutomount (22 files) run one file at a time on the branch and on a control worktree at the merge base b910aa9ed4: identical pass/fail counts and identical failing test names in all 21 shared files (the failures are Mac-shaped arms that fail the same on main on this box), the new cli.task-files-win32-8232.test.js 18/18 with no skips (real junction, symlink, GLOBALROOT/Global and deny-ACL arms ran); policy tests fixture-discipline, no-name-refs-3071, engine.reachable, engine/windows-tests-1777, engine/win32-separator-guard, engine/windows-coupling-audit-1732 67/67; worktree clean. Live: WebDAV rig, links on C: to a mapped X: and to its UNC form: origin/main's filesLines sent the server GET + PROPFIND, the new one 0 requests, a junction to a local folder still matched)
subdir_audit: passed
timestamp: 2026-11-09T14:54:48Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes (iteration 6 raised only NITs). Iteration 4 also raised only NITs; two of them were fixed in code, so iterations 5 and 6 reviewed the changed code rather than converging on code nobody had seen.
**Total findings:** 26 (2 BLOCKERs, 8 WARNINGs, 0 CONVENTIONs, 16 NITs)
**Fixed:** 20 (every BLOCKER and WARNING, 10 NITs) | **Deferred:** 2 NITs | **Noted, no change:** 4 NITs (iteration 6's three, and the pre-existing 8214 failures) | **Asked (awaiting user):** 0

Validation note: the canonical helper (validation_log_run_or_skip) failed at 6.0 because yarn/npm are absent on this Windows box; it was substituted throughout by the per-file branch-vs-control comparison above (same substitution recorded in the task-files-win-8227 proof).

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 1 BLOCKER, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
- [BLOCKER] engine/tasklist.js — a link target in raw \??\ form (\??\GLOBALROOT\Device\Mup\host\share, \??\Global\Z:\) fell to the rooted branch and the network file was then opened; reproduced on the box --> FIXED (8b873dfb74: every \\?\, \\.\, \??\ form is a drive, UNC, or refused)
- [WARNING] engine/tasklist.js — "lstat failed, return null" only safe while the walk models Windows exactly --> FIXED (8b873dfb74; reworked in iterations 2 and 3)
- [WARNING] cli.task-files-win32-8232.test.js — device fixture in a shape readlink never returns --> FIXED (8b873dfb74: real \??\ shapes, real GLOBALROOT/Global arms with a readlink-shape tripwire)
- [WARNING] engine/tasklist.js — doc comment claimed prefixed forms were handled --> FIXED (8b873dfb74)
- [NIT] engine/tasklist.js — walk/open race worth one sentence --> FIXED (8b873dfb74)
- [NIT] plan — name \??\ too --> FIXED (8b873dfb74)

#### Iteration 2
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
- [WARNING] engine/tasklist.js — a rooted \x target is ambiguous with an absolute NT \Device\Mup\ target, and a planted C:\Device\... tree defeats the missing-after-link guard --> FIXED (0a87fa7f55: rooted targets refused)
- [WARNING] engine/tasklist.js — missing-after-link refusal cost real MISSING verdicts behind junctions, with false wording --> FIXED (0a87fa7f55: every accepted target is resolved as Windows does, so ENOENT/ENOTDIR after a link is MISSING again)
- [NIT] engine/tasklist.js — any lstat error read as missing, not just ENOENT/ENOTDIR --> FIXED (0a87fa7f55)
- [NIT] engine/tasklist.js — volume wording --> FIXED (0a87fa7f55)
- [NIT] test — //host/share fixture is not a readlink shape --> kept as an extra input (it sits in the UNC loop, not under the "real shapes" comment)
- [NIT] cli.task-files-8214.test.js — 2 pre-existing Windows failures --> noted (fail identically on main; file excluded from the Windows runner)

#### Iteration 3
**New findings:** 1 BLOCKER, 1 WARNING, 0 CONVENTIONs, 2 NITs
- [BLOCKER] engine/tasklist.js — with no link before it, a non-ENOENT lstat error returned null, but a junction whose own ACL denies reading it fails lstat with EPERM while Windows still reads through it; measured --> FIXED (28d87364ae: any lookup error but not-there is refused, link or not)
- [WARNING] test — the no-link EPERM arm locked the bypass in --> FIXED (28d87364ae: expects refusal; real junction + deny-ACL arm with a control read)
- [NIT] engine/tasklist.js — filesLines doc named only the Mac rule --> FIXED (28d87364ae)
- [NIT] engine/tasklist.js — repeated refusal literals --> FIXED (28d87364ae: one helper)

#### Iteration 4
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs (would have converged)
- [NIT] engine/tasklist.js — how junctions to non-drive targets fail lstat (EISDIR / ENOENT), undocumented --> FIXED (e31ad0a462)
- [NIT] test — a failing second icacls could leave a deny entry behind --> FIXED (e31ad0a462: both inside the try/finally)
- [NIT] engine/tasklist.js — a local mount point is refused; say so --> FIXED (e31ad0a462)

#### Iteration 5
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
- [WARNING] cli.task-files-win32-8227.test.js / cli.task-files-8214.test.js — simulated-win32 filesLines arms now lstat the real host's C:/D: (a not-ready drive would change their verdicts) --> FIXED (348e447bcd: plain-folders fs passed)
- [WARNING] engine/tasklist.js — a volume mount point (EISDIR) read as "could not look at", implying a permissions problem --> FIXED (348e447bcd: refused in the mounted-volume words)
- [NIT] engine/tasklist.js — the leaves-the-drive guard is unreachable --> FIXED (348e447bcd: commented as defensive)
- [NIT] engine/tasklist.js — returns string|null unlike reachesAutomount's boolean --> DEFERRED: the walk has several distinct reasons a user should read; a boolean would lose them

#### Iteration 6
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Converged** — no new actionable findings.
- [NIT] engine/tasklist.js:418 — for a reparse point node cannot read as a link, its lstat follows it (EISDIR/ENOENT are that follow failing); safe only because such targets are local or refused by the kernel; comment could say so
- [NIT] engine/tasklist.js:416 — cloud-file placeholders (OneDrive) are read through the sync provider; outside this PR's marker-chosen-host concern, worth a scope line
- [NIT] engine/tasklist.js:428 — one over-long doc line (and one in the plan)

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | BLOCKER | engine/tasklist.js | raw \??\ device targets slipped through | FIXED | 8b873dfb74 |
| 2 | 1 | WARNING | engine/tasklist.js | lstat-fail-null unsafe after a hop | FIXED | 8b873dfb74, 0a87fa7f55, 28d87364ae |
| 3 | 1 | WARNING | test | device fixture shape not real | FIXED | 8b873dfb74 |
| 4 | 1 | WARNING | engine/tasklist.js | doc claimed prefixes handled | FIXED | 8b873dfb74 |
| 5 | 2 | WARNING | engine/tasklist.js | rooted target ambiguous with NT \Device\Mup\ | FIXED | 0a87fa7f55 |
| 6 | 2 | WARNING | engine/tasklist.js | MISSING lost behind junctions | FIXED | 0a87fa7f55 |
| 7 | 3 | BLOCKER | engine/tasklist.js | EPERM junction (deny ACL) read through | FIXED | 28d87364ae |
| 8 | 3 | WARNING | test | EPERM no-link arm locked bypass in | FIXED | 28d87364ae |
| 9 | 5 | WARNING | 8227/8214 tests | simulated arms touched the host disk | FIXED | 348e447bcd |
| 10 | 5 | WARNING | engine/tasklist.js | mounted volume misworded | FIXED | 348e447bcd |
| 11 | 5 | NIT | engine/tasklist.js | string vs boolean contract | DEFERRED | reasons are user-facing |
| 12 | 2 | NIT | test | //host/share not a readlink shape | DEFERRED | kept as extra UNC input |

### NITs (non-blocking, across all iterations)
- [NIT] engine/tasklist.js — note that node's lstat follows a reparse point it cannot read as a link (iteration 6)
- [NIT] engine/tasklist.js — cloud-file placeholders are out of scope; worth a line (iteration 6)
- [NIT] engine/tasklist.js — one over-long doc line, same in the plan (iteration 6)
- [NIT] cli.task-files-8214.test.js — 2 pre-existing Windows failures, identical on main (iteration 2)
- Iteration 1, 2, 3, 4, 5 NITs fixed as listed above

### Strengths (across all iterations)
- Links are followed one hop at a time by reading them, never resolved; a drive-letter target is checked before anything on that drive is looked up (every iteration)
- Targets accepted only in shapes whose meaning is certain; everything else fails closed (iterations 3-6)
- The scripted filesystem records every lstat, so "nothing past the link was looked up" is asserted, not inferred (every iteration)
- Real-host arms with controls proving Windows reads through what is refused (GLOBALROOT, Global, deny-ACL junction), plus a readlink-shape tripwire (iterations 3-6)
- The plan records the residual walk/open race and each conservative decision (iterations 1, 5, 6)
