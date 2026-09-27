---
pre_challenge: true
method: challenge-loop
branch: dock-contents-2864
diff_hash: 144f892f1a8700455722615c0800e34331d4645f63fd1cc22590d0f7fd9ff886
validation: passed
subdir_audit: passed
timestamp: 2026-09-27T21:45:17Z
iterations: 20
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 20
**Converged:** Yes (iteration 20: no new BLOCKER, WARNING or CONVENTION after deduplication)
**Total findings (actionable):** 0 BLOCKERs, 30 WARNINGs, 5 CONVENTIONs, plus NITs listed below
**Fixed:** all but the deferrals named below | **Deferred:** 6 | **Asked (awaiting user):** 0

Final gate (6j) on HEAD 2f92b57: tools/test-install.sh 400 passed, 0 failed, 1 block SKIPPED
(the download-path block: the tmux bundle build fails on a missing jemalloc notice on this box,
environmental); validation PASSED for hash 144f892f1a87; subdir CLAUDE.md audit passed.

### Per-Iteration Breakdown

Reviewer models rotated opus, sonnet, fable. Iterations 1 and 11 were not recorded at the time;
the model shown for them is what the rotation implies.

#### Iteration 1
**Reviewer model:** opus (rotation, not recorded)
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, NITs
**Self-generated:** 0
- [WARNING] install/setup.sh make_app: stat from PATH (a GNU stat would skip the swap) --> FIXED (9af67d5, /usr/bin/stat)
- [WARNING] install/setup.sh make_app: a swap that happened but reported failure would fall back and install the old Contents --> FIXED (9af67d5, decide by staged inode; swap-then-fail stub test)
- [WARNING] install/setup.sh: RENAME_SWAP alone follows links --> FIXED (9af67d5, flags 18 with RENAME_NOFOLLOW_ANY)
- [CONVENTION] install/setup.sh header and seam docs stale --> FIXED (9af67d5)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, NITs
**Self-generated:** 0
- [WARNING] install/setup.sh: ownership not re-proved right before the syscall --> FIXED (e7b1bef)
- [WARNING] tools/test-install.sh: stub syscall text not pinned to setup.sh --> FIXED (e7b1bef)
- [CONVENTION] tools/test-install.sh stale "SECOND install" comment --> FIXED (e7b1bef)
- Also found by the test run: flag 18 refused /var -> /private/var; FIXED with pwd -P (e7b1bef)

#### Iteration 3
**Reviewer model:** fable
**New findings:** 0 BLOCKERs, 1 WARNING, NITs
**Self-generated:** 1
- [WARNING] install/setup.sh neither-place branch returned 1, sending the caller to ~/Applications (a second Kosmos.app) --> FIXED (6fe8667)

#### Iteration 4
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, NITs
**Self-generated:** 2
- [WARNING] install/setup.sh neither-place return 0 reported a stale app as made --> FIXED (5ffcc40, rebuild stage and rename)
- [WARNING] tools/test-install.sh neither-place test could not fail --> FIXED (5ffcc40, assert new Contents)

#### Iteration 5
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, NITs
**Self-generated:** 0
- [WARNING] symlink refusal untested --> FIXED (665856f, planted-link test with link-free control)

#### Iteration 6
**Reviewer model:** fable
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, NITs
**Self-generated:** 1
- [CONVENTION] comment overclaimed the next-run sweep --> FIXED (b2af950)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, NITs
**Self-generated:** 0
- [WARNING] deep-locked test vacuous (grep for .old only) --> FIXED (3df8136, swap on/off loop, stage|old)
- [WARNING] log line did not record which path ran --> FIXED (3df8136, app_path field)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, NITs
**Self-generated:** 1
- [WARNING] plan wrongly said the release cut does not run test-install --> FIXED (4cc1c7c)

#### Iteration 9
**Reviewer model:** fable
**New findings:** 0 BLOCKERs, 3 WARNINGs, NITs
**Self-generated:** 1
- [WARNING] swap errno not logged --> FIXED (be8712b, swap_errno)
- [WARNING] test stat assignments abort under set -e --> FIXED (be8712b, || echo none)
- [WARNING] neither-place stage could block the step --> FIXED (be8712b, re-stat, fresh .r stage)

#### Iteration 10
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, NITs
**Self-generated:** 1
- [WARNING] retry paired an old errno with a new path --> FIXED (4119f22; superseded by iteration 12's design)

#### Iteration 11
**Reviewer model:** sonnet (rotation, not recorded; first launch stopped for a search outside the repo, relaunched scoped)
**New findings:** 0 BLOCKERs, 1 WARNING
**Self-generated:** 0
- [WARNING] TOCTOU: folder replaced before the swap, handed-back Contents deleted unproven --> FIXED (ea8125a, delete only if bundle_is_ours; perl-swaps-foreign test)

#### Iteration 12
**Reviewer model:** fable
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, NITs
**Self-generated:** 1
- [WARNING] per-call reset erased the system folder's errno on retry --> FIXED (b0f2f91, set only on attempt; swap_dir added, last)
- [CONVENTION] plan names stale --> FIXED (b0f2f91)

#### Iteration 13
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, NITs
**Self-generated:** 1
- [WARNING] neither-place branch deleted an unproven stage --> FIXED (3452875)

#### Iteration 14
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 1 NIT
**Self-generated:** 0
**Duplicates of prior findings:** 1 (retry swap fields, then deferred as reasoned)
- [WARNING] raw syscall number 488 not verified on macOS 13.5 --> DEFERRED: documented in the plan's Weakest part (bc8766b); XNU syscall numbers are append-only; the oldest-Mac release test is where it would show

#### Iteration 15
**Reviewer model:** fable
**New findings:** 0 BLOCKERs, 1 WARNING, 4 NITs
**Self-generated:** 0
- [WARNING] CI test of the log line never set the three new fields --> FIXED (42a4fb5, mutation-checked both ways)

#### Iteration 16
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 2 NITs
**Self-generated:** 1
- [WARNING] wedge leg drives the retry path but asserted nothing on it; plan called it untested --> FIXED (abd2d68)
- [CONVENTION] header "otherwise" misread --> FIXED (abd2d68)

#### Iteration 17
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 2 NITs
**Self-generated:** 1
**Duplicates:** 1 (harness gates, reasoned in a code comment)
- [WARNING] log-line comment lacked the caveat that swap fields can name another folder --> FIXED (264338f)

#### Iteration 18
**Reviewer model:** fable
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 1
- [CONVENTION] plan omitted that the wedge leg is full-run only --> FIXED (191ca97)

#### Iteration 19
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 4 NITs
**Self-generated:** 0
- [WARNING] final none-left check followed a glob delete and could not fail --> FIXED (2f92b57, per-run residue checks)

#### Iteration 20
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0
**Duplicates of prior findings:** 2 (syscall 488, iteration 14; empty-vs-unset harness gate, iteration 17)
**Converged**: no new actionable findings.

### Final Ledger (deferrals)

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 14 | WARNING | install/setup.sh swap call | BRANCH | syscall 488 unverified on 13.5 | DEFERRED | plan Weakest part |
| 2 | 16 | NIT | install/setup.sh stats | BRANCH | compare device plus inode | DEFERRED | stage is a sibling, same volume |
| 3 | 17 | NIT | install/setup.sh gates | BRANCH | other harness gates lack KOSMOS_SWAP_PERL | DEFERRED | reasoned in code comment |
| 4 | 18 | NIT | install/setup.sh .r rebuild | BRANCH | rebuild failure legs untested | DEFERRED | stub cost |
| 5 | 19 | NIT | install/setup.sh perl env | BRANCH | env -i instead of -u list | DEFERRED | stubs need PATH; perl-changing vars removed |
| 6 | 19 | NIT | install/setup.sh post-swap stats | BRANCH | use physical path | DEFERRED | needs the link owner |

### Outstanding questions (ASKED, still unresolved when the run ended)
- None.

### NITs (non-blocking, across all iterations)
- [NIT] install/setup.sh swap call: magic numbers inline in perl (iteration 14; pinned by test instead)
- [NIT] install/setup.sh neither-place recheck is a defensive re-read (iteration 20)
- Others fixed in the iteration commits listed above.

### Strengths (across all iterations)
- The swap is believed by where the staged inode ended up, never by the exit code (every iteration).
- RENAME_NOFOLLOW_ANY on the physical path with ownership re-proved there; ELOOP asserted with a link-free control (iterations 5, 14, 19).
- Every stub runs the real syscall where it matters, and each run is pinned to its own log line (iterations 16, 19).
- The CI test drives the shipped log-line bytes, including a swap_dir with a space (iteration 15 onward).
- The plan names its own unverified assumptions (iterations 14, 20).
