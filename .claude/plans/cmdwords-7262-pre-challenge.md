---
pre_challenge: true
method: challenge-loop
branch: cmdwords-7262
diff_hash: 773fc1125164a5bf52dfdad94f23ecf70ca6326fcdc2257124165b973aeac1a2
validation: passed
subdir_audit: passed
timestamp: 2026-10-27T08:36:47Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7 (default, sonnet, default, sonnet, default, sonnet, default)
**Converged:** Yes (round 7: no new BLOCKERs, WARNINGs or CONVENTIONs)
**Total findings:** 1 BLOCKER, 7 WARNINGs, 2 CONVENTIONs, 29 NITs (counted from the per-iteration lists below)
**Fixed:** the BLOCKER, all 7 WARNINGs, 1 CONVENTION, 11 NITs (and 1 into the PR body) | **Deferred:** 1 CONVENTION and 17 NITs, round 7's nine filed as #7320 | **Asked (awaiting user):** 0

Rounds 1 and 2 converged first. The proof was then reopened twice: once for Homer's Windows run of the PR, and once when a fresh round on the new head found more (rounds 3 to 7).

Evidence:
- **Tests:** test-support.tool-guard-4326.test.js and tools.windows-tests-schtasks-7247.test.js pass unchanged. With tools.command-words-7262.test.js that is 47 of 47 on the Mac.
- **Windows selection guard:** engine/windows-tests-1777.test.js passes 23 of 23, and is measured red without this file's ALSO_ROOT entry.
- **Windows box (Homer, at 78a50df434):** 56 pass, 1 skip, 0 fail.
- **Mutations M1 to M17:** each red, and each restored. Two copies of the line-join logic each covered for the other, so one was removed and the other is now mutation-proven.
- **Differentials:** each round compared the readers on origin/main with the branch, up to 350,000 random exec lines and 200,000 random spawn calls in round 7. No realistic call that main's guards refused is allowed now. Every shape main refused and the branch allows is one a real shell would not run that way.
- **Full validation** (tools/run-tests.sh) passed at the hash above, head f9dd5a35d4, 03:36 CDT.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** default
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above
- [WARNING] tools/lib/command-words.cjs: a $( ) or backtick inside double quotes was not read --> FIXED
- [NIT] stale not-seen clause; sudo clusters; a bare-name PATH test --> FIXED
- [NIT] tool-guard.js: the file is checked twice --> DEFERRED: harmless, and the shell: true case needs the separate check
- [NIT] an out-of-tree copy of the preload needs lib/command-words.cjs --> in the PR body

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [NIT] tool-guard.js: a comment left broken by a line edit --> FIXED
- [NIT] keyword words (if, then, {) are returned --> DEFERRED: documented; both guards ignore words they do not know
**Converged** at this point. Then reopened: Homer's Windows run found two tool-guard arms of the new test failing there, so those arms skip on win32, the file joins ALSO_ROOT, and the proof had to be redone.

#### Iteration 3
**Reviewer model:** default
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (the skip reason I had just written)
- [WARNING] the win32 skip's reason was false: run-tests.sh preloads tool-guard on Windows too --> FIXED: the reason is corrected, and #7318 is filed for tool-guard's Windows verdict
- [NIT] the test header misstated who missed sudo; on win32 the tool-guard verdict was computed and then discarded --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] a POSIX backslash was not an escape (`echo "a \" b"; gh` hid gh) --> FIXED
- [NIT] a leading backslash (`\gh`) --> FIXED
- [CONVENTION] #7318 cannot be checked from the tree --> DEFERRED: it is the card filed in round 3
- [NIT] an unterminated apostrophe in a POSIX line --> DEFERRED: a real shell runs nothing

#### Iteration 5
**Reviewer model:** default
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 1 of the above (my round-1 sudo rule)
- [WARNING] `sudo -uroot gh`: the cluster rule read the last letter of the attached value --> FIXED
- [WARNING] `pwsh -Exec Bypass -Command gh`, refused on main, was missed --> FIXED: -Command is also looked for anywhere after the program
- [NIT] fish -C; time -a; a quoted `)` inside $( ); the header's account of what each reader missed --> FIXED
- [NIT] the double file check; one red seen once and never named --> DEFERRED

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 2 WARNINGs, 1 CONVENTION, 1 NIT
**Self-generated:** 1 of the above (the BLOCKER, from my round-4 escape)
- [BLOCKER] `bash -c 'a && \<newline>gh x'` hid gh, which main refused --> FIXED: a backslash before a line end joins the lines, as bash does
- [WARNING] $'...' quoting; env -P --> FIXED
- [CONVENTION] rows for those shapes --> FIXED
- [NIT] a quoted path is pushed whole --> DEFERRED: no false positive found

#### Iteration 7
**Reviewer model:** default
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 9 NITs (8 older than this branch, 1 contrived)
**Self-generated:** 0 of the above
- [NIT] bash -c --, eval and coproc, sudo -R, $'gh' and g\h, prev after an escape, a quadratic unclosed "$(, two header wordings, the base 64 commits behind main (no touched file changed) --> DEFERRED: filed as #7320, routed with #7299
**Converged**: no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | tools/lib/command-words.cjs | BRANCH | $( ) in double quotes not read | FIXED | iteration 1 commit |
| 2 | 3 | WARNING | tools.command-words-7262.test.js | SELF | false win32 skip reason | FIXED | 8a7669c787 |
| 3 | 4 | WARNING | tools/lib/command-words.cjs | BRANCH | backslash not an escape | FIXED | 0ea63922d2 |
| 4 | 5 | WARNING | tools/lib/command-words.cjs | SELF | sudo -uroot | FIXED | acda2556c7 |
| 5 | 5 | WARNING | tools/lib/command-words.cjs | BRANCH | pwsh unlisted switch before -Command | FIXED | acda2556c7 |
| 6 | 6 | BLOCKER | tools/lib/command-words.cjs | SELF | backslash-newline hid the next command | FIXED | f9dd5a35d4 |
| 7 | 6 | WARNING | tools/lib/command-words.cjs | BRANCH | $'...' quoting | FIXED | f9dd5a35d4 |
| 8 | 6 | WARNING | tools/lib/command-words.cjs | BRANCH | env -P | FIXED | f9dd5a35d4 |

### NITs (non-blocking, across all iterations)
- [NIT] 11 fixed and 1 to the PR body (iterations 1 to 5), 17 deferred with reasons above; round 7's nine are #7320

### Strengths (across all iterations)
- One reader, with each guard keeping its own verdict; schtasks-call.cjs is now a 20-line verdict
- The agreement table runs every call shape through both guards; its true rows fail if the reader returns nothing
- Reading an ambiguous call every way and returning all its words keeps both guards on the refusing side
