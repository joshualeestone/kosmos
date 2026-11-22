---
pre_challenge: true
method: challenge-loop
branch: homer-win-pathsplit-8451
diff_hash: 4cdd3ffb6ffa789d499a851f19604295f5f749097321e348ba272c8053fd2bdc
validation: failed (helper unavailable on this box: no npm/yarn on PATH for the repo's type-check step, which is a no-op echo; validated instead by running every affected test file and the policy tests with the no-schtasks preload, all green, listed below)
subdir_audit: passed
timestamp: 2026-11-22T19:17:43Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped at the fleet's 8-round cap (no BLOCKER open), per the standing fleet rule "stop challenge loops at 8 rounds unless a BLOCKER is open; WARNINGs to a card". Round 8's two WARNINGs are carried to card #8451, which stays open.
**Total findings:** 2 BLOCKERs, 9 WARNINGs, 3 CONVENTIONs, plus NITs (listed per iteration)
**Fixed:** 18 | **Deferred:** 0 | **Carried to card (cap):** 2 WARNINGs + 2 NITs | **Asked (awaiting user):** 0

### Validation actually run (each round, no-schtasks preload, this Windows box)
- engine/startcommands.win32-pathsplit-8451.test.js (new): 3/3 tests pass, many assertions each
- engine/win32-separator-guard.test.js 4/4, engine/windows-coupling-audit-1732.test.js 8/8
- engine/hookscripts-5774.test.js 7 pass (34 POSIX-only skip), engine/startplugins-5774.test.js 3 pass, engine/tokenguard.win32-5664.test.js 26/26
- policy: engine.reachable 8/8, engine/windows-tests-1777 24/24, fixture-discipline 20/20, no-name-refs-3071 4/4
- engine/homescan-5870.test.js: 3 fail, identical names AND reasons on an untouched origin/main worktree (pre-existing on this box, not this change)
- Negative control: the end-to-end test run against origin/main's startcommands.js fails on the bug (a home on another drive is never named).

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 1 BLOCKER, 2 WARNINGs, 1 CONVENTION, 2 NITs
- [BLOCKER] engine/startcommands.js — keeping only the home's drive colon dropped the plain split, so a variable under the home (CLAUDE_PROJECT_DIR) that Git Bash splits lost its <cwd>\C folder: a missed script --> FIXED (166e82f034): every plain piece kept, home named in addition
- [WARNING] engine/startcommands.js — home match had no folder boundary --> FIXED (166e82f034), later superseded by iteration 6
- [WARNING] test — no case for a variable under the home --> FIXED (166e82f034)
- [CONVENTION] plan — weakest part did not name other variables --> FIXED (166e82f034)
- [NIT] doc comment placement; [NIT] unused default param --> FIXED (166e82f034)

#### Iteration 2
**New findings:** 1 BLOCKER, 1 WARNING, 0 CONVENTIONs, 2 NITs
- [BLOCKER] engine/startcommands.js — bare /d mapped to drive-relative D:, missing the drive root --> FIXED (b41b223dda): D:/
- [WARNING] test — asserted the faulty D: pieces; no same-drive case --> FIXED (b41b223dda)
- [NIT] blank line between doc comment and function; [NIT] plan wording --> FIXED (b41b223dda)

#### Iteration 3
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 2 NITs
- [WARNING] engine/startcommands.js — the home inside a piece (x$HOME/bin) never named --> FIXED (92ffa03d77): second split with the home in Git Bash /c/ form (measured)
- [CONVENTION] plan weakest part overstated coverage --> FIXED (92ffa03d77)
- [NIT] call-site comment on host platform; [NIT] probe path outside repo --> FIXED (92ffa03d77)

#### Iteration 4
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 0 NITs
- [WARNING] engine/startcommands.js — Git Bash converts TMP, TEMP, TMPDIR too (measured) --> FIXED (26167c9242)

#### Iteration 5
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs (would have converged)
- [NIT] drive-root converted value (HOME=D:\) --> FIXED (9ff1cc6598, 74ac2707cc)
- [NIT] plan signature line; [NIT] tests passed a string, not a list --> FIXED (9ff1cc6598)
- Code changed after this round, so review continued.

#### Iteration 6
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
- [WARNING] engine/startcommands.js — whole-folder-name rule missed ${HOME}.local/bin on another drive --> FIXED (6f4c7ee54b): any occurrence
- [NIT] either-slash match --> FIXED (6f4c7ee54b); [NIT] signature-length test --> FIXED (6f4c7ee54b)
- [NIT] /tmp is mounted on the user Temp folder, not Git's root: relevant to card item 3, not this diff --> carried to card

#### Iteration 7
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION-level NIT, 2 NITs
- [WARNING] engine/startcommands.js — one piece holding the home's text from a converted and an unconverted variable was not named --> FIXED (7a7afbe9f5): every choice of rewritten occurrences, cap 8 then fail closed
- [NIT] comment overstated TMP coverage (no TMP in baseVars; unexpanded $TMP already reported) --> FIXED (7a7afbe9f5)
- [NIT] plan said "whole occurrence" --> FIXED (7a7afbe9f5)
- [NIT] homescan-5870 pre-existing failures on this box --> noted (same on origin/main)

#### Iteration 8 (cap)
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
- [WARNING] engine/startcommands.js:369 — Git Bash also converts LD_LIBRARY_PATH, ORIGINAL_PATH and SHELL (re-measured by the orchestrator: all three print /d/foo/bar; PKG_CONFIG_PATH, MANPATH, USERPROFILE, APPDATA, CLAUDE_PROJECT_DIR stay D:\). Two are path lists (; to :). --> CARRIED TO CARD #8451 (cap)
- [WARNING] engine/startcommands.js:355 + plan — comment and plan say "exactly" four variables --> CARRIED TO CARD #8451 (cap; fixed with the list)
- [NIT] value.substr is deprecated --> CARRIED TO CARD #8451
- [NIT] no table test pinning the converted set --> CARRIED TO CARD #8451

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | BLOCKER | startcommands.js | home colon kept instead of plain split | FIXED | 166e82f034 |
| 2 | 1 | WARNING | startcommands.js | no folder boundary | FIXED | 166e82f034 |
| 3 | 1 | WARNING | test | variable-under-home case | FIXED | 166e82f034 |
| 4 | 1 | CONVENTION | plan | weakest part | FIXED | 166e82f034 |
| 5 | 2 | BLOCKER | startcommands.js | bare drive not root | FIXED | b41b223dda |
| 6 | 2 | WARNING | test | locked-in D: pieces | FIXED | b41b223dda |
| 7 | 3 | WARNING | startcommands.js | home inside a piece | FIXED | 92ffa03d77 |
| 8 | 3 | CONVENTION | plan | coverage overstated | FIXED | 92ffa03d77 |
| 9 | 4 | WARNING | startcommands.js | TMP/TEMP/TMPDIR converted | FIXED | 26167c9242 |
| 10 | 6 | WARNING | startcommands.js | whole-name rule too strict | FIXED | 6f4c7ee54b |
| 11 | 7 | WARNING | startcommands.js | mixed converted/unconverted piece | FIXED | 7a7afbe9f5 |
| 12 | 7 | CONVENTION | startcommands.js | TMP coverage comment | FIXED | 7a7afbe9f5 |
| 13 | 8 | WARNING | startcommands.js | LD_LIBRARY_PATH/ORIGINAL_PATH/SHELL converted | CARRIED | card #8451 (cap) |
| 14 | 8 | WARNING | startcommands.js + plan | "exactly four" wording | CARRIED | card #8451 (cap) |

Before iteration 1, the orchestrator's own measurement also caught that its first rule named the wrong folder for a typed drive path (Git Bash splits C:/x); fixed in 05dec95590 before review began, not counted above.

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### Carried to card #8451 at the cap (not fixed in this branch)
- Add LD_LIBRARY_PATH, ORIGINAL_PATH, SHELL to GIT_BASH_CONVERTS, handling list values (C:\a;D:\b) by splitting on ; or reporting unreadable; correct "exactly four" in comment and plan; table test of the converted set; substr -> slice.
- Item 3 note: Git Bash mounts /tmp on the user's Temp folder, not under Git's install folder.

### NITs (non-blocking, across all iterations)
- homescan-5870.test.js fails 3 on this box, identically on origin/main (iterations 4-8)

### Strengths (across all iterations)
- Off Windows the splitter returns value.split(':') unchanged, pinned by a test on every platform
- Deny-guard-correct superset design: never drops a name the old code produced
- Pure splitter cases run on all platforms; end-to-end cases gated to Windows; file name carries win32 so Windows CI selects it
- Every Git Bash claim backed by an on-box measurement recorded in the plan
