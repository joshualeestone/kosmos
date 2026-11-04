---
pre_challenge: true
method: challenge-loop
branch: linuxupdate-7935
diff_hash: f2bde6a2e4bf5a6feac470c8266869367486b93e391627cdabbcd65899ffb9fa
validation: local (web*, cli.*, install.* and engine/update* tests, 594 files, run from the worktree root: 5212 pass, 0 fail, 6 skipped, on e94278fec6, the head rebased onto origin/main); the full suite runs on the PR's CI
subdir_audit: not run (no CLAUDE.md in the diff)
timestamp: 2026-11-04T13:24:05Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped at iteration 8 under Splinter's 8-round rule (past 8 only with a BLOCKER open); round 8 raised no BLOCKER. A rule stop, not a user stop.
**Total actionable findings:** 1 BLOCKER, 22 WARNINGs, 0 CONVENTIONs (plus NITs)
**Fixed:** 1 BLOCKER, 16 WARNINGs | **Kept and stated (decided, with reasons):** 6 WARNINGs | **Asked:** 0

The last suite ran on e94278fec6 (the head this proof covers, rebased onto origin/main).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 4 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0
- [BLOCKER] engine/update.js - the curl | sh command passed no channel, so a staging board would install prod's build and lose its subscription --> FIXED (69ce0100fe): the command is this install's own `kosmos update --if-newer --install`
- [WARNING] non-default home ignored --> FIXED with the same change
- [WARNING] curl | sh skipped the signed-manifest check (#6468) --> FIXED with the same change
- [WARNING] focus fell to <body> when Check hid --> FIXED (69ce0100fe)
- [WARNING] a screen reader never heard the command --> FIXED (69ce0100fe): a read-only field described by the status line, with Copy

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs
**Self-generated:** 0
- [WARNING] the live-board run is unmeasured --> KEPT, stated; PigeonPete to measure in #7933
- [WARNING] no arm for a stopped Linux board --> FIXED (d59b56793f)
- [WARNING] the card did not say the board restarts --> FIXED (d59b56793f)
- [WARNING] Linux auto-install recorded a refusal on every look --> FIXED (d59b56793f) at autoInstallWouldStart

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs
**Self-generated:** 1 (the copy-result clearing written in iteration 1)
- [WARNING] the shell read the real uname, so CLI tests meant different things on a Linux host --> FIXED (3f8ae686e7): KOSMOS_PLATFORM
- [WARNING] Settings offered an auto-update switch that never acts on Linux --> FIXED (3f8ae686e7); the #5865 test's opposite claim corrected
- [WARNING] "Command copied." outlived the command; empty status took room --> FIXED (3f8ae686e7)
- [WARNING] the Copy handler had no behaviour test --> FIXED (3f8ae686e7)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING
**Self-generated:** 1 (the round-3 clear ran on every paint)
- [WARNING] the poll wiped the copy result under the same command --> FIXED (4d97ad7489)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs
**Self-generated:** 1 (the round-3 `:empty { display: none }`)
- [WARNING] over Kosmos+ the row told a phone to run it "on this computer" --> FIXED (a13dca3f49)
- [WARNING] no update toast for a manual offer --> KEPT, filed as kosmos#7938 (shared with Windows)
- [WARNING] display:none on a live region may stop it speaking --> FIXED (a13dca3f49)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs
**Self-generated:** 0
- [WARNING] a terminal inside Kosmos closes on the installer's restart --> FIXED (e0e8262a55): "outside Kosmos"
- [WARNING] a paused fleet makes --install do nothing --> KEPT, stated (#6781 design)
- [WARNING] shell and engine decide "Linux" separately --> KEPT, stated (engine arm is Linux by name)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 5 NITs
**Self-generated:** 0
- [WARNING] the live-board run is unmeasured --> KEPT, stated (#7933)
- NITs fixed (fb146ec1c9): refusal Linux-only, remote focus, payload comment, repaint test, plan text

#### Iteration 8
**Reviewer model:** sonnet (whole branch, nothing pre-cleared)
**New findings:** 0 BLOCKERs, 2 WARNINGs, 3 NITs
**Self-generated:** 0
- [WARNING] a Check press that lands the command left focus on <body> --> FIXED (041167f274, rebased as e94278fec6)
- [WARNING] "Kosmos restarts" rests on the unmeasured run --> KEPT, stated
**Stopped** - iteration 8, the cap, no BLOCKER open.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | engine/update.js | BRANCH | curl | sh loses the channel | FIXED | 69ce0100fe |
| 2 | 1 | WARNING | engine/update.js | BRANCH | home ignored | FIXED | 69ce0100fe |
| 3 | 1 | WARNING | engine/update.js | BRANCH | unverified installer | FIXED | 69ce0100fe |
| 4 | 1 | WARNING | web/index.html | BRANCH | focus dropped | FIXED | 69ce0100fe |
| 5 | 1 | WARNING | web/index.html | BRANCH | not announced | FIXED | 69ce0100fe |
| 6 | 2 | WARNING | install/kosmos | BRANCH | live board unmeasured | KEPT | #7933 |
| 7 | 2 | WARNING | cli test | BRANCH | stopped board | FIXED | d59b56793f |
| 8 | 2 | WARNING | web/index.html | BRANCH | restart not said | FIXED | d59b56793f |
| 9 | 2 | WARNING | engine/update.js | BRANCH | auto refusal each look | FIXED | d59b56793f |
| 10 | 3 | WARNING | install/kosmos | BRANCH | real uname in tests | FIXED | 3f8ae686e7 |
| 11 | 3 | WARNING | web/index.html | BRANCH | dead auto switch | FIXED | 3f8ae686e7 |
| 12 | 3 | WARNING | web/index.html | SELF | stale copy result | FIXED | 3f8ae686e7 |
| 13 | 3 | WARNING | web test | BRANCH | copy untested | FIXED | 3f8ae686e7 |
| 14 | 4 | WARNING | web/index.html | SELF | poll wiped result | FIXED | 4d97ad7489 |
| 15 | 5 | WARNING | web/index.html | BRANCH | remote wording | FIXED | a13dca3f49 |
| 16 | 5 | WARNING | web/index.html | BRANCH | no toast | KEPT | #7938 |
| 17 | 5 | WARNING | web/index.html | SELF | live region hidden | FIXED | a13dca3f49 |
| 18 | 6 | WARNING | web/index.html | BRANCH | terminal inside Kosmos | FIXED | e0e8262a55 |
| 19 | 6 | WARNING | install/kosmos | BRANCH | paused fleet | KEPT | #6781 |
| 20 | 6 | WARNING | install/kosmos | BRANCH | two Linux rules | KEPT | stated |
| 21 | 7 | WARNING | install/kosmos | BRANCH | live board unmeasured | KEPT | #7933 |
| 22 | 8 | WARNING | web/index.html | BRANCH | press focus | FIXED | e94278fec6 |
| 23 | 8 | WARNING | web/index.html | BRANCH | restart claim | KEPT | #7933 |

### Outstanding questions
None.

### NITs (non-blocking)
- the hidden Check button keeps data-act (as the Windows arm)
- KOSMOS_HOME exported in the person's shell would win over the script's own home (pre-existing)

### Strengths
- One rule (canSelfInstall) gates the offer, the auto path and the refusal, so they cannot disagree; Mac and Windows unchanged and pinned
- The command is the install's own verified verb, carrying channel, subscription and base; prod and staging pinned in the CLI test
- Mutants red for every rule across shell, engine and board
