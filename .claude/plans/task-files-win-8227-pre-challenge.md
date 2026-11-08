---
pre_challenge: true
method: challenge-loop
branch: task-files-win-8227
diff_hash: be16f2cf1f778d7773347a88f1bc9287e1136fe39004666e4ea8a659cf31388b
validation: substituted (the helper needs yarn/npm, which this Windows box does not have; instead, with the no-schtasks preload: at 972e593078 the new cli.task-files-win32-8227.test.js and tools.windows-kosmos-cli-570.test.js with the policy tests (fixture-discipline, no-name-refs-3071, engine.reachable, engine/windows-tests-1777, engine/win32-separator-guard, engine/windows-coupling-audit-1732) 138/138 pass; every test file that names filesLines, windrives, builtFilePath, --file, task built or tasklist (47 files) run one file at a time on the branch and on a control worktree at the merge base 351b293a38: identical pass/fail counts and identical failing test names in all 46 shared files (the failures are Mac-shaped arms, e.g. the bash CLI, that fail the same on main on this box); the 25 of those that touch the Windows CLI, tasklist, tasks or the built routes rerun at 972e593078: again identical to main (486 pass, 36 fail, all also failing on main), plus the new file 7/7; worktree clean. Live: a drive mapped with net use to a local WebDAV server that logs every request: the old filesLines sent it PROPFIND + GET, the new one nothing; a worktree board kept a C: path and no X: path)
subdir_audit: passed
timestamp: 2026-11-08T07:25:14Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes. Iteration 6 returned no BLOCKER, WARNING or CONVENTION; its four NITs are listed below.
**Total findings:** 19 (0 BLOCKERs, 14 WARNINGs, 3 CONVENTIONs, plus NITs)
**Fixed:** 15 | **Deferred:** 2 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
- [WARNING] engine/tasklist.js driveRefusal — a remembered mapping whose server is offline can be missing from GetDrives or read 1, and was opened --> FIXED (a5e22a7ce5: reuse engine/windrives.js, which reads it as remote; a letter with no drive is refused too)
- [WARNING] engine/tasklist.js driveTypesHere — a second copy of the windrives probe --> FIXED (a5e22a7ce5: removed; windrives.infoOf exported)
- [WARNING] tools/windows/kosmos-cli.js — the reason a path was not kept was thrown away; the generic line was wrong for an unreadable kind --> FIXED (a5e22a7ce5: pathWhy said)
- [NIT] named set of local kinds; [NIT] plan understated the cost; [NIT] tests pinned the fail-open letters (all moot after the fix)

#### Iteration 2
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 3 NITs
- [WARNING] windrives driveInfo starts a background learn the one-shot CLI would wait for --> FIXED (fcb2858645: infoOf never schedules one)
- [WARNING] the CLI inherited the board's 3 s learn bound --> FIXED (fcb2858645, then 28e8164e6e: infoOf's own 10 s default)
- [WARNING] engine/tasklist.js — a local link to a UNC target is still opened --> DEFERRED: a known gap, stated in the plan, posted on kosmos#8227, filed as kosmos#8232 (iteration 5); needs a Windows link walk, out of this card's scope
- [CONVENTION] the kind-to-verdict mapping written twice --> FIXED (fcb2858645: tasklist.driveKind, one verdict both sides read)
- [NIT] older windrives without infoOf; [NIT] infoOf only wraps; [NIT] test pinned a lower-case letter (fixed)

#### Iteration 3
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
- [WARNING] the real-table test used the 3 s default --> FIXED (28e8164e6e: the default is the one-shot bound)
- [WARNING] tools.windows-kosmos-cli-570 arms now depended on a live PowerShell read --> FIXED (28e8164e6e: its helper answers drive kinds as local)
- [WARNING] infoOf's default was the board's bound --> FIXED (28e8164e6e: ONE_SHOT_TIMEOUT_MS)
- [NIT] the bare catch hid an incomplete install (fixed: 'old' words); [NIT] two seams (fixed: driveInfoFor); [NIT] absent words (fixed); [NIT] doc block placement (fixed)

#### Iteration 4
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 5 NITs
- [WARNING] the new win32 test booted a whole board, which the Windows runner does not --> FIXED (d69d6dfcf0: board-less, the CLI against a scripted board)
- [WARNING] the timeout was not covered by the test --> FIXED (d69d6dfcf0: the learn seam is handed the bound and the test asserts it)
- [WARNING] the board's refresh interval could trip the no-background-learn assertion --> FIXED (d69d6dfcf0: no board in the file)
- [CONVENTION] the plan named a constant that does not exist --> FIXED (d69d6dfcf0)
- [NIT] tasklist loaded two ways (fixed in iteration 5); [NIT] a shared isDrivePath (left); [NIT] a throwing reader crashed the run (fixed); [NIT] dangling doc (fixed); [NIT] infoOf repeats current() (left: documented why)

#### Iteration 5
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 4 NITs
- [WARNING] an old windrives made task files say "could not read" but task built say "update" --> FIXED (d734dc99a6: an 'old' verdict both verbs word)
- [WARNING] task built read driveKind from a tasklist that might lack it --> FIXED (d734dc99a6: checked, read as 'old'; tasklist loaded through ctx.engine in both verbs)
- [WARNING] the link gap needs a real follow-up card --> DEFERRED as in iteration 2, and the card now exists: kosmos#8232
- [CONVENTION] run the policy tests --> FIXED (run: engine.reachable flagged an orphan export, DRIVE_KINDS_OLD, removed in 972e593078; then 138/138)
- [NIT] NEEDS_WINDOWS name (fixed); [NIT] why-map (fixed); [NIT] board timeout constant (left, windrives' own code); [NIT] infoOf vs current() (left)

#### Iteration 6
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/tasklist.js | stale/disconnected mapping opened | FIXED | a5e22a7ce5 |
| 2 | 1 | WARNING | engine/tasklist.js | duplicate drive probe | FIXED | a5e22a7ce5 |
| 3 | 1 | WARNING | tools/windows/kosmos-cli.js | reason for a dropped path lost | FIXED | a5e22a7ce5 |
| 4 | 2 | WARNING | engine/windrives.js | background learn in a one-shot CLI | FIXED | fcb2858645 |
| 5 | 2 | WARNING | engine/windrives.js | board's 3 s bound for the CLI | FIXED | fcb2858645, 28e8164e6e |
| 6 | 2 | WARNING | engine/tasklist.js | local link to a UNC target opened | DEFERRED | known gap, kosmos#8232 |
| 7 | 2 | CONVENTION | tools/windows/kosmos-cli.js | verdict mapping written twice | FIXED | fcb2858645 |
| 8 | 3 | WARNING | cli.task-files-win32-8227.test.js | real-table test on the 3 s default | FIXED | 28e8164e6e |
| 9 | 3 | WARNING | tools.windows-kosmos-cli-570.test.js | arms coupled to a live PowerShell read | FIXED | 28e8164e6e |
| 10 | 3 | WARNING | engine/windrives.js | default bound a trap | FIXED | 28e8164e6e |
| 11 | 4 | WARNING | cli.task-files-win32-8227.test.js | board booted on the Windows runner | FIXED | d69d6dfcf0 |
| 12 | 4 | WARNING | cli.task-files-win32-8227.test.js | timeout not covered | FIXED | d69d6dfcf0 |
| 13 | 4 | WARNING | cli.task-files-win32-8227.test.js | board refresh could trip an assertion | FIXED | d69d6dfcf0 |
| 14 | 4 | CONVENTION | plan | named a missing constant | FIXED | d69d6dfcf0 |
| 15 | 5 | WARNING | tools/windows/kosmos-cli.js | old install worded differently per verb | FIXED | d734dc99a6 |
| 16 | 5 | WARNING | tools/windows/kosmos-cli.js | driveKind read from a tasklist that may lack it | FIXED | d734dc99a6 |
| 17 | 5 | WARNING | engine/tasklist.js | link gap needs a card | DEFERRED | filed kosmos#8232 |
| 18 | 5 | CONVENTION | policy tests | run them | FIXED | 972e593078 |

### Outstanding questions (ASKED, still unresolved when the run ended)
- none

### NITs (non-blocking, across all iterations)
- iteration 4: tools/windows/kosmos-cli.js — a shared isDrivePath export would give the record side and the check side one definition of "a drive path"
- iteration 4/5: engine/windrives.js — infoOf repeats current()'s staleness logic; a shared helper with a background flag would keep them aligned (left: the doc comment says why they differ)
- iteration 5: engine/windrives.js — the board's 3 s learn bound is a bare literal (windrives' existing code)
- iteration 6: tools/windows/kosmos-cli.js:1655 — task files could treat a tasklist without driveKind as 'old' too (CLI and engine ship in one zip)
- iteration 6: tools/windows/kosmos-cli.js:1659 — the driveInfo spread is redundant now that driveInfo is always a function
- iteration 6: the CLI's why-map and tasklist's driveRefusal word the same verdicts separately (a driveWhy beside driveRefusal would keep the words in one module)
- iteration 6: engine/windrives.js — infoOf drops a stale shared table; harmless in a one-shot process, worth a warning in its comment for any board caller

### Strengths (across all iterations)
- Reuses the #7232 windrives table (remembered mappings, UTF-8, redirector failure) instead of a second probe; the rejected options are recorded with reasons
- Fails closed at every layer, and each refusal says why on its own line; an unreadable table is said in full once, then named
- Tests record what was OPENED and SENT, not only what was printed; an off-Windows control proves the kinds are never asked there
- The new Windows file boots no board, so the Windows runner can run it; the 570 arms no longer depend on a live PowerShell read
- Measured live against a real network drive whose server counts requests, with the old code as the control
- The remaining link gap is named, not hidden, and filed as kosmos#8232
