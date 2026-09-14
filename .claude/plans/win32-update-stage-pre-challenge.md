---
pre_challenge: true
method: challenge-loop
branch: win32-update-stage
diff_hash: 27e3c2e4c12620484ba695d195f8a3a6f724cc497295310f9c0b7ed15f08060f
validation: passed
subdir_audit: passed
timestamp: 2026-09-13T04:05:00Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7 (opus rounds 1, 3, 4 and 5; sonnet rounds 2, 6 and 7).
**Converged:** Yes. Round 7 found NO NEW FINDINGS.
**Fixed:** every finding from rounds 1-6. The full per-round record is in the plan's
Review log (`.claude/plans/win32-update-stage-20260912T171425Z.md`): findings, fixes,
revert controls and stress tables.
**Asked (awaiting user):** 0. The coordinator made the design calls in the loop:
- the sweep is best-effort for every error code;
- the wall-clock boot rule was removed in favour of the process-image rule;
- `exe` is stamped only when it can't be misread;
- ENOENT at the claim's removal counts as cleared.

`diff_hash` is the sha256 of the raw bytes of `git diff origin/main HEAD -- .
':!.claude/plans/win32-update-stage-pre-challenge.md'`, computed with node over git's
own output. It was taken at `8fb474d9` (229,979 bytes), on origin/main `9ceed247`, 16
commits ahead and 0 behind. The pre-challenge-gate hook is not installed on this
Windows box, so the recipe is written out here.

**Validation of record.** Round 7 ran the suites on this box with the anchored
`node.exe` v24.19.0, via PowerShell, under the schtasks guard
(`NODE_OPTIONS=--require=C:\Users\joshu\kosmos-scripts\no-schtasks-preload.cjs`):

| Suites | Result |
|---|---|
| `engine/win32update`, `engine/win32zip`, `engine/win32orphan`, `engine/win32anchor`, `engine/win32anchor.world-1704`, `engine/win32swap`, `engine/platform-gate-wiring`, `engine/platform-gate-download`, root `engine.reachable` | **168 tests: 167 pass, 1 skip** |

- The skip is the real-build test, which needs `KOSMOS_WIN_ZIP_SAMPLE`. Against the
  0.6.55 prod zip it staged, and its `node.exe` ran.
- The schtasks block log was never created: no call was attempted.
- The live CLI check (real HTTP on 127.0.0.1, a scratch ROOT and anchor, staged in
  1.9 s with nothing outside WORK changed) ran at the round-1 head. Later rounds
  changed only the lock and its cleanup, which the suites and the stress runs cover.

**Control runs.** Every guard, reverted on its own against a saved copy of the source,
turns a test red, and none hangs:
- round 1: 90;
- round 2: 12;
- rounds 3-6: 28, rerun at the round-6 head.

**Stress.** A real multi-process harness: 60 s runs, an external kill every 150 ms, and
1% self-kills.

| When | Runs | Racers | Max holders | Wedges | Result |
|---|---|---|---|---|---|
| Round 3 (review) | 7 | 2,531 total | 1 | 0 | Found the Windows cleanup races |
| Round 3 (after the fixes) | 3 | 8/12/16 | 1 | 0 | 0 wrong drive sentences, 0 raw errors, 0 holder crashes |
| Round 4 (review, then after its fixes) | 2 + 2 | 12/16 | 1 | 0 | 0 of every failure |

### Iteration 1 (opus): 3 BUGs, 1 CONVENTION, TEST-GAPs, NITs
- **CONVENTION:** raw control bytes made git treat `win32zip.js` as binary.
- **BUGs:**
  - a lexical protected-folder check (a junction got past it);
  - a lock that could let two prepares run;
  - a path guard that missed temp files.
- **TEST-GAPs and NITs:** 8.3 names, reserved names, local and central header checks,
  a minimal staged-node environment, the world fallback, and one shared size rule.

All fixed.

### Iteration 2 (sonnet): 1 BUG, 2 TEST-GAPs
- **BUG:** a FAT/exFAT hard-link failure leaked a raw error.
- **TEST-GAPs:** orphaned drafts; the stale-lock race.

Root fix: a live owner holds at any age, and a dead lock is removed only by the holder
of its claim after a byte-identical re-read. Rename-aside was dropped (it gave 2 holders
with 4 racers).

### Iteration 3 (opus): exclusion held; 3 BUGs, TEST-GAP, SAFETY, NITs
- **BUGs** (Windows cleanup races):
  - a swept draft read as a FAT drive;
  - a cleanup throw that could wedge the lock;
  - a sweep throw that failed the working prepare.
- **SAFETY:** pid reuse after a reboot.
- **NITs:** a stat/read race, a future `at`, an unreadable lock.

All fixed.

### Iteration 4 (opus): 2 SAFETY, TEST-GAP
- **SAFETY 1:** round 3's wall-clock boot rule could take a live owner's lock after a
  clock step. It was REPLACED by the process-image rule (`tasklist`), where every doubt
  holds.
- **SAFETY 2:** a failed release wedged later prepares. Fixed with a retry plus
  remembering the exact lock text.
- **TEST-GAP:** the probe-loop bounds are now pinned.

The rebase conflict with #2961 was resolved to one size rule.

### Iteration 5 (opus): 1 SAFETY, 1 BUG, 2 NITs
- **SAFETY:** a symlink-launched or non-ASCII node name could clear a live lock. `exe`
  is now stamped only when it is ASCII and equals the realpath basename, and a garbled
  `tasklist` answer holds.
- **BUG:** a raw EPERM path from the claim's unlink. Now a sentence.
- **NITs:** the `os.uptime` pin; the S4 note on the synchronous lookup.

### Iteration 6 (sonnet): 1 BUG (low), TEST-GAP
- **BUG:** ENOENT at the claim's removal refused. It now counts as cleared; ownership
  still comes only from the exclusive link, and a race test covers it.

It also verified by measurement that the shipped hard-linked runtime is stamped.

### Iteration 7 (sonnet): NO NEW FINDINGS

It re-verified the round-6 safety condition in the code and walked the interleavings:
- the lock vanishing and then being replaced before the link;
- the claim file;
- draft cleanup on refusal.

The new tests exercise those exact branches.
