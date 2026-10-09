---
pre_challenge: true
method: challenge-loop
branch: launchpath-5516
diff_hash: bd78901a33845d09320afd0b3fa617b156f4cc6a4872158abc228fe8011e72f3
validation: passed (Mortals full suite at d2db42ea1, hash bd78901a3384)
subdir_audit: passed
timestamp: 2026-10-09T07:38:55Z
iterations: 24
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 24, each a fresh blind reviewer, alternating Opus and Sonnet (rounds 1 and 2 by the first author, round 3 on by the second).
**Converged:** Yes, at iteration 24 (Sonnet): its one warning was the recorded deny-list growth follow-up, sharpened (the sandbox layer needs a ceiling too); its nits were recorded before. **Findings:** every BLOCKER and WARNING fixed or decided with a written reason; decided residuals and later parts are listed in the plan's review log at the level of the class.
**Validation:** engine/launchpath-5516.test.js, engine/boardkeychain-4491.test.js and the related suites (351 pass after the rebase onto main); each fix's mutation made a test fail; the sandbox profile size limit measured with sandbox-exec; the browser-check surface gate passes; full suite on Mortals at the head named above. Rebased onto main after #5122 merged (28 commits, no conflicts). After convergence, the first full-suite run found two new POSIX temp-root literals for the Windows coupling audit; they are classified as inventory rows (test file only; the scan returns before them on Windows), and the second run passed.

## Ledger (iteration by iteration)

# launchpath-5516 ledger (rounds 1-2 by Angel; 3 parked)
#### Iteration 3 (Opus, Renet's fresh review; Angel's round-3 findings were not recorded) on 61df544b8
- [BLOCKER] (B3) setup-assistant.js:683/:687-693/~:763: a launch folder whose path has a rule-pattern character (( ) [ ] { } ! * ? \) sets tokenRuleDropped, so guardTokenOnlyFolder returns before writing ANYTHING (measured: "App (Beta)/bin" pane entry, or a link into it -> ok:false, no settings.json; control /usr/bin ok). FIX: keep launch-folder rules out of tokenRuleDropped; an unruleable launch folder goes to launchUnsafe (guard says not whole) while its denyWrite (a concrete path) is still written; test with a parenthesised folder + control.
- [WARNING] (W3a) :595-596 missing PATH entries canonicalised with realOr, not realOrLeaf: the agent-folder check fails open under a symlinked parent; /var or /tmp spellings not /private (Seatbelt). FIX: realOrLeaf for PATH entries and link targets; test a missing entry under a symlink.
- [WARNING] (W3b) :573-576 + bin/agent-supervisor.sh:71/1358: the supervisor runs $CLAUDE, $NODE_BIN, $TMUX_BIN (+ Kosmos tmux), engine scripts by ABSOLUTE path; their folders are not guaranteed on the pane PATH. FIX: pass these to the guard too (env), or record the gap.
- [WARNING] (W3c) :602-610 coverage stops at the program's own folder, not what it loads (npm global node_modules/<pkg>/lib, keg lib, site-packages). FIX: widen to the package/keg root, or record as a residual.
- [WARNING] (W3d) :683 and :573 comments claim "nothing the agent writes can run at its next start": overclaims. FIX: say what is covered and name what is not (rc files, git config are part 2).
- [NIT] ~100 Cellar/node_modules dirs added; the 4000-entry cap fails closed (say so in the plan). Bash PATH from rc snapshot unmeasured.
- Applied 20:1x: B3 FIXED (launch rules out of the token filter; launchUnsafe copy; test + mutation red). W3a FIXED (realOrLeaf; test + mutation red). W3d FIXED (comments). W3b and W3c OPEN: recorded in the plan as the next work (W3b may matter: the supervisor's engine scripts are off-PATH; measure writability first).
- W3b FIXED (own engine, bin, node folders; test + mutation red; 54 guard tests pass).
- W3c DECIDED residual (rejected parent-of-bin widening: denies shared trees; rejected per-layout list: drifts); recorded in plan.
- R4 (sonnet): W4a FIXED (supervisor drops own/inside/link/not-yet entries; 2 mutations red); W4b+W4c DECIDED residual; W4d FIXED wording; nit cache key FIXED; 3 nits not changed.
- R5 (opus): 2 BLOCKER FIXED (installed supervisor dir + test), W aliases/shell-agree/pin FIXED, create-refusal DECIDED keep, pruning DECIDED follow-up, nits fixed.
- R6 (sonnet): W6a/W6b FIXED (drop dot-segment and pattern-char entries; 2 mutations red); W6c DECIDED residual (ancestor replace); nits recorded.
- R7 (opus): BLOCKER (mcp tree + --settings file) FIXED; chain hops, dangling, unlistable, case, not-yet drop, uncoverable-target test, pins, convention FIXED; 10 mutations red.
- R8 (sonnet): W8a claude/tmux dirs FIXED, W8b/c cache-per-pass + memo FIXED, W8d PATH-key test FIXED, nits fixed; 5 mutations red.
- R9 (opus): BLOCKER+middle-links FIXED (walk per name, holders), missed lookups FIXED, ENOTDIR FIXED; program-level residual + config-named programs DECIDED later part; written-check removed as redundant (holders subsume it).
- R10 (sonnet): W10a dotdot-after-link FIXED (fail-open; 2 mutations red), cap FIXED, ancestor-holder note DECIDED residual; '/' pinned by test.
- R11 (opus): tmux conf + LaunchAgents FIXED; shell-rc code DECIDED later part; spelling, alias both-spellings, file-no-widen, eng/node written, cycle tests, try/catch FIXED; 9 mutations red.
- R12 (sonnet): link files FIXED, tmux spellings FIXED, win32 scan OFF DECIDED (later part, Homer), main-checkout lock DECIDED residual; 3 mutations red.
- R13 (opus): shared roots + dangling-as-file FIXED, launch-secrets FIXED, file-pattern/throw/bare-name tests; 7 mutations red (the shared list entries other than tmpdir are data, not individually pinned).
- R14 (sonnet): linked-dotfile false not-whole FIXED, shared by containment FIXED, install-time cost DECIDED; 3 mutations red.
- R15 (opus): link-by-name (Edit only) for unexempted holders FIXED, shared-holder below agent said FIXED, shared spellings FIXED, header FIXED; gitignore-semantics guard on link names (never /tmp,/var); 6 mutations red.
- R16 (sonnet): over-deny by folder -> by-name model (dirs only for run-by-name folders; program files by name; file links Edit-only; folder links no rule, said only in temp); tests rewritten; 6 mutations red; real PATH whole.
- R17 (opus): temp-held file link said FIXED; through-folder-link spelling aliases FIXED; 3 mutations red; 4 nits recorded.
- R18 (sonnet): hardlink residual DECIDED+header; cache-key + alias-dots tests FIXED (2 mutations red); secrets-door PATH measured not reachable (allowlist).
- R19 (opus): folder-link naming FIXED (Edit(//tmp) case); run-progs versions store FIXED; repoint + soft-link residuals DECIDED; nits fixed; 4 mutations red.
- R20 (sonnet): no-token log FIXED, host-dependent wholeness test FIXED, launch-secrets base FIXED (my first expression was wrong; caught before commit), middle reason FIXED.
- R21 (opus): pattern-named program file -> folder fallback FIXED (+alias gate); boardkeychain tests pinned FIXED; plan summary FIXED; pane-keeps-shared-entry DECIDED residual; 4 mutations red.
- R22 (sonnet): left-out log FIXED, unlistable dropped FIXED, /// FIXED, blank line FIXED; 3 mutations red.
- R23 (opus): sandbox profile 64KB limit MEASURED; program files Edit-only FIXED (23 sandbox entries real PATH); tmux includes/git config DECIDED later part; 2 mutations red.
- R24 (sonnet): CONVERGED (warning = recorded accumulation follow-up, sharpened: sandbox ceiling; nits recorded).
- Mortals 1 (dc162b114) FAILED: windows-coupling-audit-1732 found 2 fs-root literals (the temp roots). Classified as two INVENTORY rows (scan returns before them on Windows). Mortals 2 queued.
