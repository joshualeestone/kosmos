---
pre_challenge: true
method: challenge-loop
branch: launchertext-7492
diff_hash: 2aa1a4bcb30c1985946023ac17daf7b3c3587f537404279e8fb6a55b24dd54be
validation: passed
subdir_audit: passed
timestamp: 2026-10-28T18:23:30Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes
**Total findings:** 16 (0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, 11 NITs)
**Fixed:** 9 | **Deferred:** 4 | **Asked (awaiting user):** 0

Final validation (6j): the full suite at da7c68f6a6, 25330 tests, 0 failed, subdir audit clean. Two earlier full runs
failed only on timing tests in files this branch does not touch (all passed alone); the first overlapped with another
suite on this Mac.

The exe (tools/windows/Kosmos.exe) was rebuilt and Authenticode-signed twice by Homer on the Windows box, because
iteration 1 changed the box text: verify-launcher OK, signature Valid, native tests 30/30, signin-6512 10/10, at
b9ee111482 (source c330290a04). Iterations 2 and 3 changed tests and the README only.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] tools/windows/KosmosLauncher.cs:125 -- "within about a minute" is false under the watchdog's 15-minute back-off --> FIXED (c330290a04): no time in the sentence
- [NIT] KosmosLauncher.cs -- a PORT-override launch: the watchdog may start the usual board while the box is open --> DEFERRED: recorded in the plan (iteration 2)
- [NIT] tools/windows/README.md:39 -- the README said less than the box --> FIXED (c330290a04)
- [NIT] plan -- the claim holds on main only; merge after #7495 --> FIXED (c330290a04)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] tools.win-launcher-native.test.js -- nothing in CI checks the exe carries the source's text --> FIXED (31a461173c): every string constant must be in the exe
- [WARNING] KosmosLauncher.cs:124 -- a PORT-override launch gets a box about the usual Kosmos --> DEFERRED: a developer or test launch; recorded in the plan's weakest premise
- [NIT] .claude/plans/win32-launcher-native-20260912T2148Z.md -- old plan quotes the old text --> DEFERRED: a historical record
- [NIT] KosmosLauncher.cs -- wording taste ("Settings in Kosmos") --> DEFERRED: the switch name matches the page exactly

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 2 of the above
- [WARNING] tools.win-launcher-native.test.js -- a cut-off sentence still matched inside an older exe --> FIXED (da7c68f6a6): csc length prefix required, with a cut-sentence control; SELF
- [WARNING] tools.win-launcher-native.test.js -- constants built with + skipped --> FIXED (da7c68f6a6): folded, 70 values, none unresolved; SELF
- [NIT] control pinned to exact whitespace (CRLF) --> FIXED (da7c68f6a6)
- [NIT] README said "starts" flatly --> FIXED (da7c68f6a6)
- [NIT] csharpLiteral decodes only the escapes used --> FIXED (da7c68f6a6): said in the comment; another escape fails, never passes

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Converged** -- no new actionable findings.
- [NIT] a const string form the pattern does not match is not listed --> filed as #7503 (Renet has it)
- [NIT] a very short constant could match unrelated bytes --> noted; verify-launcher.ps1 still compares bytes
- [NIT] the text is pinned in two places --> noted; the plan names #7493

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | tools/windows/KosmosLauncher.cs:125 | BRANCH | "within about a minute" false under back-off | FIXED | c330290a04 |
| 2 | 2 | WARNING | tools.win-launcher-native.test.js | BRANCH | no CI check the exe matches the source | FIXED | 31a461173c |
| 3 | 2 | WARNING | tools/windows/KosmosLauncher.cs:124 | BRANCH | PORT-override launch | DEFERRED | developer case, in the plan |
| 4 | 3 | WARNING | tools.win-launcher-native.test.js | SELF | truncation passes | FIXED | da7c68f6a6 |
| 5 | 3 | WARNING | tools.win-launcher-native.test.js | SELF | concatenated constants skipped | FIXED | da7c68f6a6 |

### NITs (non-blocking, across all iterations)
- An unmatched const string form is not listed (iteration 4): #7503.
- A very short constant could match unrelated bytes (iteration 4).
- An old plan quotes the old text (iteration 2): a historical record.

### Strengths (across all iterations)
- Every sentence of the box was checked against the code for each case it shows, by three reviewers: the Settings switch and the watchdog's gate are the same bit (iterations 1, 3, 4).
- The label test ties the box's quoted switch name to the page's startAtSignInLabel and was shown red on a reworded label (iteration 1).
- The exe-text test reads what ships: UTF-16 behind the ECMA-335 length prefix, folded constants, two controls (a changed word and a cut sentence), red on the older exe and green on main and on the rebuilt one (iterations 2-4).
