---
pre_challenge: true
method: challenge-loop
branch: openerenv-5889
diff_hash: 868bc61eaeb9fb89d449e8c7bbc991dd6cdfb048108c3befc8e4a997eed69761
validation: Mortals full validation 2026-10-12T17:15:09Z at 8110a7fac: 19341 tests, 19098 pass, 0 fail, 243 skipped (status clean, hash 868bc61e). Re-checked locally the same hour: validation_log_run_or_skip skipped on that clean entry, subdir audit passed, 0 merge conflicts with origin/main.
subdir_audit: passed
timestamp: 2026-10-12T17:15:52Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6 blind reviews: sonnet, opus, sonnet, opus, sonnet, opus.
**Converged:** Yes, at iteration 6 (opus): NITs only, no new BLOCKER, WARNING or CONVENTION.
**Fixed:** every WARNING below. **Deferred:** the Linux no-display regression test (reason in iteration 5). **Asked:** 0.
Written by hand from the plan's Review sections (1 to 4) and the session record (5 and 6): reviews 5 and 6 are not in
the plan because editing the plan after Mortals validated it would change the diff hash it validated.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet (blind, on 2dd89e63b)
**New findings:** 4 WARNINGs, 2 NITs
- [WARNING] engine/childenv.js: the allowlist missed what xdg-open and a browser it starts read (BROWSER, XDG dirs, LANGUAGE, LC_, USER, LOGNAME, TMPDIR, GDK/QT backend, MOZ_ENABLE_WAYLAND, WSL, proxies) --> FIXED
- [WARNING] engine/remote.js: "no display" sent WSL and a named BROWSER straight to "use the link" --> FIXED (hasDesktop counts them)
- [WARNING] engine/remote.test.js: the leak test's secrets lived only in the injected env --> FIXED (secrets in real process.env)
- [WARNING] engine/remote.test.js: vouchSignedIn needed a display through the seam on a Linux machine --> FIXED
- [NIT] seam reset and a top-level require --> FIXED

#### Iteration 2
**Reviewer model:** opus (blind, on c33bbda5c)
**New findings:** 4 WARNINGs, 2 NITs
- [WARNING] the Windows decision cited "said on #5889" and nothing had been said there --> FIXED (#5895 filed, decisions posted)
- [WARNING] no test failed with the display arms removed --> FIXED (one Linux case per arm: DISPLAY, WAYLAND, WSL, VS Code Remote)
- [WARNING] input method and HiDPI variables missing --> FIXED
- [WARNING] BROWSER alone counted as a desktop (a terminal browser shows nothing) --> FIXED (only with VSCODE_IPC_HOOK_CLI)
- [NIT] LC_ by prefix --> FIXED (13 standard names); KRB5CCNAME and MATE_DESKTOP_SESSION_ID added

#### Iteration 3
**Reviewer model:** sonnet (blind, on 2edb66cc3)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs (all fixed: comments, the systemd-unit display limit stated, a test helper)

#### Iteration 4
**Reviewer model:** opus (blind, on fe92debba; run because the t.after leak fix came after review 3)
**New findings:** 2 WARNINGs
- [WARNING] the positive test covered 11 of 64 keys --> FIXED in 8110a7fac (the allowlist pinned in the test; mutant WAYLAND_DISPLAY dropped: red)
- [WARNING] vouchTick also calls runCompanyOpener and reaches its existing "could not open" branch on a Linux board with no display, unsaid --> FIXED in 8110a7fac (named in the comment)

#### Iteration 5
**Reviewer model:** sonnet (blind, on 8110a7fac)
**New findings:** 2 WARNINGs
- [WARNING] macOS behaviour under the allowlist unmeasured --> MEASURED on Mortals 06:3x: /usr/bin/open -g <url> under childenv.openerEnv (HOME, LANG, LOGNAME, PATH, TMPDIR, USER) exits 0 with no stderr, and also with an empty env. The browser window itself was not seen (the GUI check over ssh hung).
- [WARNING] no regression test for a Linux board with no display --> DEFERRED: the vouch flow's fixture is heavy and the branch reached is the one that existed before for a failed open; documented in the runCompanyOpener comment.

#### Iteration 6
**Reviewer model:** opus (blind, on 8110a7fac)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, NITs only
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/childenv.js | BRANCH | allowlist missed opener and browser variables | FIXED | review 1 commits |
| 2 | 1 | WARNING | engine/remote.js | BRANCH | WSL and BROWSER read as no display | FIXED | review 1 commits |
| 3 | 1 | WARNING | engine/remote.test.js | BRANCH | leak test secrets only in injected env | FIXED | review 1 commits |
| 4 | 2 | WARNING | engine/remote.js | BRANCH | no test per display arm | FIXED | review 2 commits |
| 5 | 2 | WARNING | engine/remote.js | BRANCH | BROWSER alone counted as a desktop | FIXED | review 2 commits |
| 6 | 4 | WARNING | engine/remote.test.js | BRANCH | positive test covered 11 of 64 keys | FIXED | 8110a7fac |
| 7 | 5 | WARNING | engine/remote.js | BRANCH | Linux no-display regression test | DEFERRED | heavy fixture; existing branch; documented |

### Outstanding questions
None.

### Strengths
- The opener gets an allowlisted environment, so the board's whole environment (tokens, keys) never reaches the browser it starts; the allowlist is pinned in a test and each display arm has its own case.
