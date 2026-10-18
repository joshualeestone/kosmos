---
pre_challenge: true
method: challenge-loop
branch: updater-sig-win-1765
diff_hash: 6f09b3c6d8340f425192c3dbebd4fab0e8a48e5755226fdae414ab1d16d006ad
diff_hash_of: git diff c4f215d29...22a248fad (everything before this record)
validation: substituted (the helper needs yarn, which this Windows box does not have; instead the full node suite, engine/*.test.js and *.test.js, ran at dff45526b and at origin/main c4f215d29 with the no-schtasks preload, --test-force-exit and a 180 s per-test limit: branch 21674 tests, 3050 fail; main 21658 tests, 3048 fail; failing tests compared by file, name and reason (ports, temp names and timestamps normalised). Five entries failed on the branch run only: each was re-run alone on both trees. communityfollow.test.js and server.tmux-a11y-status-2911.test.js pass on the branch. server.restartnote-5359.test.js fails on both trees in the same way. win32agysignin.e2e.test.js passes on the branch. win32agyreply.e2e.test.js, a real Antigravity agent run, failed 2 of 6 branch runs and 0 of 6 main runs, each time with the agent's own spawn ENOENT; it passed on the branch's last four runs and touches no updater code. Three file-level entries failed on main only. The last code commit, 323df7225, changed only comments, error wording and a test helper. Its five affected test files were re-run and pass: 199 pass, 1 unrelated skip.)
subdir_audit: passed
timestamp: 2026-10-18T02:14:13Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes. Iteration 3 raised no BLOCKERs and no WARNINGs; its NITs were applied.
**Total findings:** 0 BLOCKERs, 6 WARNINGs, about 15 NITs
**Fixed:** 6 WARNINGs and every NIT except the optional lazy skip | **Deferred:** 0 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 5 WARNINGs, 5 NITs
- [WARNING] engine/win32update.js: redirected PowerShell 5.1 output used the console code page and best-fit mapped characters, so a lookalike signer could read as the real name. FIXED: non-ASCII is escaped inside PowerShell, and the output is UTF-8 as well. A Windows test signs copies with lookalike names and checks that each name arrives unchanged.
- [WARNING] engine/win32update.js: toLowerCase folds the Kelvin sign to k. FIXED: the comparison ignores ASCII case only, and anything non-ASCII is refused. Pure tests cover it.
- [WARNING] engine/win32update.js: a PowerShell failure showed its command line, not its reason. FIXED: the message now uses PowerShell's stderr, and an unreadable answer has its own sentence.
- [WARNING] engine/win32update.js: execFileSync blocked the board. FIXED: execFile is used and awaited (verifyStaged is async).
- [WARNING] .claude/plans/WINDOWS-ROADMAP.md: still called the signature check a pending seam. FIXED.
- NITs: ctx.env (FIXED), the real-release test now asks Windows (FIXED), the missing-file test asserts a rejection (FIXED), a skip when Microsoft's root is absent (FIXED), and chain.Build being ignored (kept, to match setup.ps1).

#### Iteration 2
**New findings:** 0 BLOCKERs, 1 WARNING, 5 NITs
- [WARNING] engine/win32update.signature-1765.test.js: the lookalike test left its private key behind. FIXED: the certificate is removed with -DeleteKey, and the test asserts that the key folder count is unchanged. The leftover keys from earlier runs were removed, matched by time and size.
- NITs, all FIXED: names in a refusal are escaped and capped; PSModulePath is dropped from the child environment; an oversized answer has its own message; the fake timeout matches the real rejection; one shared root-present skip.

#### Iteration 3
**New findings:** 0 BLOCKERs, 0 WARNINGs, NITs only
- NITs, all FIXED except the optional lazy skip: the exe size in a comment; the probe's wording and its full path; a timeout counted only when the time limit fired; the CLIXML header skipped; a comment that the rollback is not signature-checked.
**Converged**: no new actionable findings.

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/win32update.js | code-page best-fit of signer name | FIXED | ASCII-escaped answer + test |
| 2 | 1 | WARNING | engine/win32update.js | Kelvin-sign case folding | FIXED | ASCII-only compare + test |
| 3 | 1 | WARNING | engine/win32update.js | error showed command line | FIXED | stderr reason |
| 4 | 1 | WARNING | engine/win32update.js | blocked event loop | FIXED | async execFile |
| 5 | 1 | WARNING | WINDOWS-ROADMAP.md | stale seam line | FIXED | updated |
| 6 | 2 | WARNING | signature test | leaked private key | FIXED | -DeleteKey + count assertion |

### Strengths (across all iterations)
- The pins are read out of setup.ps1 and held equal by a test.
- The check runs before anything staged is run or swapped. A refusal leaves the installed build untouched and writes no journal.
- Real on-box proof: the committed signed Kosmos.exe and the published 0.7.55 release pass. A one-byte-tampered copy, a copy with its signature stripped, node.exe (same Microsoft chain, different signer) and lookalike signers are all refused.
- Every new test failed under a mutation that removed its check (ten mutations), then passed once restored.
