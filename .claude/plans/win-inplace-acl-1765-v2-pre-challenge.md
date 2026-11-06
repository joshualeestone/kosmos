---
pre_challenge: true
method: challenge-loop
branch: win-inplace-acl-1765-v2
diff_hash: d95c249388e2a66f400732831a517982b7908e8e4670000aaaadb98b96472217
validation: substituted (the helper needs yarn/npm, which this Windows box does not have; instead, at 7183d06008, 17 test files ran with the no-schtasks preload: tools.win-inplace-acl-1765, tools.win-launcher-native, -board-proof-1765, -download-say-7403, -reproof-6882, -signin-6512, -stuck-board-4543, tools.win-taskbar-badge-3996, tools.win-installer-native, tools.win-open-board-2007, tools.win-setup-ps1 and the six policy tests; 299 tests, 297 pass, 0 fail, 2 skipped (no 8.3 names on this volume, and one platform skip); tools/windows/verify-launcher.ps1 OK (the committed signed Kosmos.exe reproduces from the committed source); worktree clean. Two earlier runs right after a fresh rebuild had 6 tests in tools.win-launcher-reproof-6882 fail with "spawn UNKNOWN" (a just-compiled probe refused to start); that file passes 26/26 alone on the branch and on origin/main, and the full re-runs were clean)
subdir_audit: passed
timestamp: 2026-11-06T11:18:27Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped by the fleet 8-round rule (Splinter, 2026-10-22, restated 2026-10-26 16:08 CDT over Slack: "challenge loops stop at 8 rounds unless a BLOCKER is open; later WARNINGs go to a follow-up card"). No BLOCKER is open. Iteration 8 raised one WARNING, which is FIXED in 7183d06008 with a test that fails without the fix, but that fix was not reviewed by a further round.
**Total findings:** 1 BLOCKER, 14 WARNINGs, 2 CONVENTIONs, about 20 NITs
**Fixed:** 17 | **Deferred:** 0 | **Asked (awaiting user):** 0

Live proof on the Windows box with the final signed Kosmos.exe (Authenticode Valid, Kosmos Agent Manager, Inc.): run from C:\kt-1765 (Authenticated Users: Modify, inherited from C:\) it refuses in plain words and names the person's Downloads folder; run from a folder in the profile it passes this check and stops at the next one ("still inside the zip"). Mutation controls: the WebView2/planted-DLL, owner, folder-walk, bin\, per-file, drive-root and run-folder-link tests each fail with their rule switched off.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
- [WARNING] tools/windows/KosmosLauncher.cs — runtime\WebView2Loader.dll, loaded into the launcher for --window, not read on its own --> FIXED (add7bc4d3a, probe case)
- [WARNING] tools/windows/README.md — a copy already running in place gets a surprise refusal when the window reopens; undocumented --> FIXED (add7bc4d3a, README and plan)
- [NIT] junction outside the profile not walked above its target (fixed in iteration 8); [NIT] v1 plan beside v2 (handled in iteration 7)

#### Iteration 2
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
- [WARNING] tools/windows/KosmosLauncher.cs — refusal names C:\Users\<them>\Downloads, which may not exist when Downloads was moved --> FIXED (cde015fd78, FreshCopyFolder with a real-folder test)
- [WARNING] tools/windows/KosmosLauncher.cs — DLLs beside node.exe in runtime\ not read --> FIXED (cde015fd78)
- [NIT] owner/FAT branches untested (owner fixed in iteration 3); [NIT] long lines; [NIT] junction comment

#### Iteration 3
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 3 NITs
- [WARNING] existing in-place copies stay exposed with no tracked follow-up --> FIXED (#1765 comment 6682841166; README and plan point at it)
- [WARNING] the owner rule has no test --> FIXED (595c7cc595, currentUser seam; fails with the rule off)
- [CONVENTION] plan file name had no timestamp --> FIXED (renamed to win-inplace-acl-1765-v2-20261106T1034Z.md)
- [NIT] NameOf can stall on an unreachable domain controller; [NIT] source-text regexes; [NIT] test.after placement

#### Iteration 4
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
- [WARNING] the reason items are read on their own did not hold together; folders under app\ that stop inheriting were not read --> FIXED (1a843cebd7, 25a9536ab3)
- [WARNING] a FAT or exFAT drive could be told as an unknown owner --> FIXED (missing permissions now reported first)
- [NIT] network share accounts (fixed in iteration 5); [NIT] doubled backslash in a comment --> applied; [NIT] test name --> applied; [NIT] plan sync --> applied

#### Iteration 5
**New findings:** 1 BLOCKER, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
- [BLOCKER] tools/windows/KosmosLauncher.cs — bin\, first on every agent's PATH, never read --> FIXED (491c741543: every folder at any depth is read; tests for bin\ and a file in it fail without the walk)
- [WARNING] a network share's well-known accounts are the file server's --> FIXED (refused)
- [WARNING] the folder walk followed junctions --> FIXED (a link inside is refused)
- [NIT] repeated drive-root expression --> AsDirectoryPath; [NIT] GENERIC_WRITE in the ancestor mask; [NIT] test sweep scope

#### Iteration 6
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 6 NITs
- [WARNING] files under app\ taken at their folder's word, cost asserted not measured --> FIXED (d2a25a1a21: every file read; measured 829 files, about 90 ms first, 40 ms after, only outside the profile)
- [NIT] a test pinned the old gap as safe --> now expects the refusal; [NIT] missing-folder case inside a skipping test --> own test; [NIT] review-round labels in comments --> removed; [NIT] README overlong lines and fallback --> applied; [NIT] zip check now after this one (wording only)

#### Iteration 7
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 6 NITs
- [WARNING] a file link inside was read through to its target --> FIXED (455c97b939: refused like a folder link)
- [WARNING] DELETE on a data drive's root refused every folder on it --> FIXED (455c97b939: subst test makes a real drive root)
- [CONVENTION] the v1 plan contradicts the code --> FIXED (marked superseded)
- [NIT] long paths; [NIT] named pass repeated on purpose --> comment added; [NIT] comment placement --> fixed; [NIT] zip check order; [NIT] test.after placement; [NIT] roadmap line placement

#### Iteration 8
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
- [WARNING] tools/windows/KosmosLauncher.cs — a run folder that is a link, or sits behind one, was read at its target and never on the link --> FIXED (7183d06008, not reviewed by a further round; test fails without the rule)
- [NIT] fold the superseded v1 plan into v2; [NIT] NameOf domain lookup can stall

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | tools/windows/KosmosLauncher.cs | WebView2Loader.dll not read | FIXED | add7bc4d3a |
| 2 | 1 | WARNING | tools/windows/README.md | in-place window refusal undocumented | FIXED | add7bc4d3a |
| 3 | 2 | WARNING | tools/windows/KosmosLauncher.cs | refusal names a Downloads that may not exist | FIXED | cde015fd78 |
| 4 | 2 | WARNING | tools/windows/KosmosLauncher.cs | DLLs beside node.exe not read | FIXED | cde015fd78 |
| 5 | 3 | WARNING | tools/windows/README.md | in-place exposure untracked | FIXED | #1765 comment 6682841166 |
| 6 | 3 | WARNING | tools.win-inplace-acl-1765.test.js | owner rule untested | FIXED | 595c7cc595 |
| 7 | 3 | CONVENTION | .claude/plans/ | plan name without timestamp | FIXED | 595c7cc595 |
| 8 | 4 | WARNING | tools/windows/KosmosLauncher.cs | incoherent per-item model; app\ subfolders | FIXED | 1a843cebd7, 25a9536ab3 |
| 9 | 4 | WARNING | tools/windows/KosmosLauncher.cs | FAT told as unknown owner | FIXED | 1a843cebd7 |
| 10 | 5 | BLOCKER | tools/windows/KosmosLauncher.cs | bin\ on PATH never read | FIXED | 491c741543 |
| 11 | 5 | WARNING | tools/windows/KosmosLauncher.cs | network share accounts | FIXED | 491c741543 |
| 12 | 5 | WARNING | tools/windows/KosmosLauncher.cs | walk followed junctions | FIXED | 491c741543 |
| 13 | 6 | WARNING | tools/windows/KosmosLauncher.cs | files below taken at folder's word | FIXED | d2a25a1a21 |
| 14 | 7 | WARNING | tools/windows/KosmosLauncher.cs | file link read through | FIXED | 455c97b939 |
| 15 | 7 | WARNING | tools/windows/KosmosLauncher.cs | drive root DELETE | FIXED | 455c97b939 |
| 16 | 7 | CONVENTION | .claude/plans/win-inplace-acl-1765-20261018T0645Z.md | stale v1 plan | FIXED | 455c97b939 |
| 17 | 8 | WARNING | tools/windows/KosmosLauncher.cs | run folder that is or sits behind a link | FIXED | 7183d06008 (not re-reviewed) |

### Outstanding questions (ASKED, still unresolved when the run ended)
- None.

### NITs (non-blocking, across all iterations)
- [NIT] tools/windows/KosmosLauncher.cs NameOf — a domain SID lookup can stall on a laptop away from its domain controller (iterations 3, 8)
- [NIT] tools/windows/KosmosLauncher.cs — paths past 260 characters refuse with "could not be read" (iteration 7)
- [NIT] tools/windows/KosmosLauncher.cs — the zip check now runs after this one, so a TEMP outside the profile gets this refusal instead of "extract the zip" (iterations 6, 7)
- [NIT] tools/windows/KosmosLauncher.cs — GENERIC_WRITE in the ancestor mask is stricter than the comment says (iteration 5)
- [NIT] tools.win-inplace-acl-1765.test.js — source-text assertions; test.after placement; drive-root sweep scope (iterations 3, 5, 7)
- [NIT] .claude/plans/ — fold the superseded v1 plan into v2; WINDOWS-ROADMAP line placement (iterations 7, 8)

### Strengths (across all iterations)
- The check runs before every errand in Main, the uninstall included, and a source test pins that order (iterations 1 to 8)
- Fails closed throughout; deny entries never counted; accounts compared by SID (iterations 1 to 8)
- Real permissions set with icacls, owner and profile seams, end-to-end launcher runs at the drive root (iterations 3 to 8)
- The committed signed Kosmos.exe reproduces from the source (iterations 1 to 8)
