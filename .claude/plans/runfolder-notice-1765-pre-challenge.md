---
pre_challenge: true
method: challenge-loop
branch: runfolder-notice-1765
diff_hash: f405ff8e80684c86a4215ebf6cc3ffa533dca21ce65f5a7ec2ea32de88061c67
validation: substituted (the helper needs yarn/npm, which this Windows box does not have; instead, at 624afc846b, with the no-schtasks preload: engine/win32runfolder.test.js plus 16 launcher, installer and policy test files, 316 tests, 314 pass, 0 fail, 2 skipped (no 8.3 names on this volume; a platform skip); server.runfolder-1765.test.js 1/1 run on its own (it boots a board, and run beside tools.win-launcher-stuck-board-4543 on this box the two see each other's processes; the Windows CI job runs neither file next to the other, as it runs only win32-named files and boots no board); the browser-check meta tests (120) fail on exactly the 12 tests origin/main fails on this box; tools/windows/verify-launcher.ps1 OK; worktree clean. The Playwright check itself cannot run here (no Playwright on this box); its page behaviour was checked live in a private browser against the branch page: the notice at 390 px, a refused and an accepted dismiss, the pending retry (nothing, then the notice on a later ask), one chain for three overlapping starts, and the live region filled and cleared)
subdir_audit: passed
timestamp: 2026-11-06T15:21:19Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes. Iteration 6 returned no BLOCKER, WARNING or CONVENTION; its four NITs are listed below.
**Total findings:** 1 BLOCKER, 12 WARNINGs, 1 CONVENTION, about 22 NITs
**Fixed:** 14 | **Deferred:** 0 | **Asked (awaiting user):** 0

After the loop: one commit, 624afc846b, adds the check's name to docs/browser-checks/gated.txt (the #1387 rule, found by running the browser-check meta tests on the branch and on origin/main). It changes no code and was not reviewed by a further round. And after the first CI run: one commit adds #runfolder-slot to the floating stack's :empty rule (web.cert-notice-6613, red in CI; 29/29 here after) and carries Browser-check-surface trailers for the seven checks whose tokens that line or the notice's reused classes touch (the #2518 gate, run here: it fails without the trailers and passes with them). No logic changed; not reviewed by a further round.

Live proof on the Windows box: `Kosmos.exe --check-run-folder`, built from this source, answers `{"safe":false,...}` with the reason and the words from a folder at the drive root (Authenticated Users: Modify) in about 0.35 s, and `{"safe":true}` from a folder in the profile; knowsFlag reads the branch's Kosmos.exe as knowing the flag and the installed 0.7.93 one as not. Mutation controls: the recheck, dismissed-in-flight, ASKING_ENV and knowsFlag-gate tests each fail with their fix switched off.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 1 BLOCKER, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
- [BLOCKER] web/index.html — the page asked once and the board fills the notice after it starts serving, so a page open across a restart never showed it --> FIXED (4e31c828c1: the route says pending, the page asks again)
- [WARNING] tools/windows/KosmosLauncher.cs — "After that you can delete" invited deleting under a running board --> FIXED (same sign-in wording as the refusal)
- [WARNING] tools/windows/KosmosLauncher.cs — a momentary read failure showed a false alarm --> FIXED (checked:false, logged)
- [NIT] route test only covers null; [NIT] profile source comment --> applied; [NIT] HEAD body; [NIT] verify-launcher evidence --> run every round

#### Iteration 2
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 4 NITs
- [WARNING] engine/win32runfolder.js — unreadable silenced the notice for good, including an account hiding a folder on purpose --> FIXED (a29842c751: asked once more after 30 s, then the softer words)
- [WARNING] tools.win-inplace-acl-1765.test.js — the built-launcher test skipped its answer silently --> FIXED (shape always asserted; a diagnostic when the safe arm cannot run)
- [CONVENTION] tools/windows/README.md — --check-run-folder undocumented --> FIXED
- [NIT] browser check comment; [NIT] a control that could not fail --> real control; [NIT] older launcher (fixed in iterations 3 and 4); [NIT] remote reads of local paths

#### Iteration 3
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
- [WARNING] engine/win32runfolder.js — an older launcher beside newer code could loop through ordinary starts --> FIXED (20ada668c4: KOSMOS_RUNFOLDER_ASKING; a board started under it never asks)
- [WARNING] tools/windows/KosmosLauncher.cs — unreadable versus can-change was a search of a sentence that quotes folder names --> FIXED (a flag set where it fails to read; a folder named "could not be read" is tested)
- [NIT] done(again) --> applied; [NIT] timeout comment measured --> applied; [NIT] stale test comment --> applied; [NIT] shared restart-note style --> noted in a comment

#### Iteration 4
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
- [WARNING] engine/win32runfolder.js — nothing checked that the Kosmos.exe asked knows the flag --> FIXED (04c3901140: knowsFlag reads the flag's UTF-16 spelling from the file first)
- [WARNING] web/index.html — the page's retry budget sat a few seconds above the board's worst case --> FIXED (asks while pending, cap only as a safety net)
- [NIT] profile from the env seam --> applied; [NIT] 8.3 names (revisited in iteration 5); [NIT] asked flag on a throw; [NIT] live region (fixed in iteration 5); [NIT] double polling (fixed in iteration 5)

#### Iteration 5
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
- [WARNING] web/index.html — the one-chain guard was released during the 3 s wait --> FIXED (88f3cf8e06: held across the wait; checked live)
- [WARNING] engine/win32runfolder.js — realpath followed junctions the launcher never follows --> FIXED (written-path comparison again, the cost named in the header)
- [WARNING] engine/win32runfolder.js — a dismiss while the answer was on its way did not stick --> FIXED (DISMISSED)
- [NIT] live region --> applied; [NIT] sync read of Kosmos.exe --> async; [NIT] source-text unref test --> behavioural; [NIT] server catch --> tidied

#### Iteration 6
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | BLOCKER | web/index.html | page asked before the answer, never again | FIXED | 4e31c828c1 |
| 2 | 1 | WARNING | tools/windows/KosmosLauncher.cs | delete before the next sign-in | FIXED | 4e31c828c1 |
| 3 | 1 | WARNING | tools/windows/KosmosLauncher.cs | momentary read failure shown as alarm | FIXED | 4e31c828c1 |
| 4 | 2 | WARNING | engine/win32runfolder.js | unreadable silenced for good | FIXED | a29842c751 |
| 5 | 2 | WARNING | tools.win-inplace-acl-1765.test.js | answer shape skipped silently | FIXED | a29842c751 |
| 6 | 2 | CONVENTION | tools/windows/README.md | flag undocumented | FIXED | a29842c751 |
| 7 | 3 | WARNING | engine/win32runfolder.js | older launcher could loop | FIXED | 20ada668c4 |
| 8 | 3 | WARNING | tools/windows/KosmosLauncher.cs | classification by sentence search | FIXED | 20ada668c4 |
| 9 | 4 | WARNING | engine/win32runfolder.js | launcher not checked for the flag | FIXED | 04c3901140 |
| 10 | 4 | WARNING | web/index.html | retry budget too tight | FIXED | 04c3901140 |
| 11 | 5 | WARNING | web/index.html | one-chain guard released in the wait | FIXED | 88f3cf8e06 |
| 12 | 5 | WARNING | engine/win32runfolder.js | realpath versus GetFullPath | FIXED | 88f3cf8e06 |
| 13 | 5 | WARNING | engine/win32runfolder.js | dismiss lost to an in-flight answer | FIXED | 88f3cf8e06 |

### Outstanding questions (ASKED, still unresolved when the run ended)
- None.

### NITs (non-blocking, across all iterations)
- [NIT] engine/win32runfolder.js — USERPROFILE versus the known-folder profile can differ (iteration 6)
- [NIT] tools/windows/KosmosLauncher.cs RunningFolderMessage — the words say "other people who use this computer" for a network share too (iteration 6)
- [NIT] tools/windows/KosmosLauncher.cs LinkOnTheWay — an unexpected attribute-read failure is told as a link, not re-asked (iteration 6)
- [NIT] engine/win32runfolder.js — module-wide state assumes one atStart per process (iteration 6)
- [NIT] server.js — HEAD writes a body, as the damaged-files route does (iteration 1)
- [NIT] server.js — the route gives remote sessions local paths, as the damaged-files route does (iteration 2)

### Strengths (across all iterations)
- One implementation of the folder rule: the board asks the launcher, answered before anything else in Main (iterations 1 to 6)
- Two independent guards against an older launcher: the flag read from the file, and ASKING_ENV (iterations 4 to 6)
- Costs nothing off Windows, for a source checkout, or inside the profile, each tested (iterations 1 to 6)
- Every failure to the log, never to the screen; the page escapes the launcher's words (iterations 1 to 6)
