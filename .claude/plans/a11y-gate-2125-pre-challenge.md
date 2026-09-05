---
pre_challenge: true
method: challenge-loop
branch: a11y-gate-2125
diff_hash: 60e57eaf1cd89b416718ad127c77f1a42cda9fbd1a33f7a8c5eea5d06eee0276
validation: passed
subdir_audit: passed
timestamp: 2026-09-05T03:21:19Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 across two runs. The first run (6.0 fix + two blind reviews) converged;
the branch was then rebased onto a newer origin/main (a tools/browser-checks.sh check-list
union plus auto-merges of unrelated files), which changed the diff base and required a
fresh proof, so a fourth blind review ran on the rebased tree.
**Converged:** Yes — the final review returned zero NEW BLOCKER/WARNING/CONVENTION.
**Total findings:** 1 BLOCKER (initial-validation), 2 WARNINGs, 8 NITs; plus many STRENGTHs.
**Fixed:** 7 | **Deferred:** 4 (1 WARNING by ruling + 2 NITs by design + 1 NIT duplicate) | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1 (6.0 baseline validation)
- [BLOCKER] web.firstrun-a11y-1214.test.js — the full suite red 3 tests: slice-3's gate + copy change superseded the #1214/#1940 offer-not-require contract those tests pinned, but they were never reconciled. --> FIXED: updated to the shipped #2125 gated contract, keeping every still-valid assertion. The "run the existing suite before 'no regression'" lesson.

#### Iteration 2 (first blind review)
- [WARNING] native-app/main.swift — the under-tmux spawn path was exercised by no test that runs it. --> FIXED: added a real under-tmux arm to tools/test-a11y-writer-mock-2125.sh (the actual `tmux -L kosmos-axcheck new-session -d '<exe> --kosmos-app-axcheck'` shape with AGENT_WORKFORCE_DATA), asserting the reading lands under the store the engine reads; measured that a private -L socket's fresh server inherits the env.
- [NIT] dead `const fn` slice in the shape test. --> FIXED.
- [NIT] web/index.html soft-open-at-entry undocumented. --> FIXED (explicit comment; also fixed a brittle fixed-distance test window it exposed).

#### Iteration 3 (second blind review) — converged (first run)
- [NIT] soft-open at entry — DUPLICATE of iteration 2. Resolved.
- [NIT] native-app/main.swift currentlyTrusted() ignored staleness. --> FIXED: bounded to 300s (a11ystatus.STALE_AFTER_MS), pinned by a source-wiring assertion.
- [NIT] KOSMOS_AXCHECK_FORCE_TRUSTED live seam. --> DEFERRED: must stay live in the release binary for the build-bundle smoke; codebase test-seam pattern, never set by the installer.
- [NIT] build-smoke axprompt dialog. --> DEFERRED: benign on cut machines; preserves the flag-drift catch.

#### Iteration 4 (post-rebase blind review) — converged (final)
- [WARNING] native-app/main.swift — the false-block safety is gated by the RELEASE PROCESS (the deferred fresh-install verify), not by any in-code guard; a #2125-carrying build reaching prod without the verify could false-block if the under-tmux attribution reads the app's trust. Reviewer recommended the plan's bias-to-trusted default. --> DEFERRED by Splinter's explicit ruling (2026-09-04): ship the REAL writer, no bias. Reasoning (mine, ruled decisive): bias makes the writer inert, so the attribution can never be verified, so the gate never works and can never be un-biased (chicken-and-egg) -- the bias trades a functional feature for a permanently dead one. Safety strengthened OUT of code instead: Splinter makes the deferred fresh-install verify a HARD prod-promote gate he owns (no #2125 build promotes until it confirms no false-block), with a DEFINED FAILURE ACTION (if the verify shows a false-block: fix the attribution, OR apply the bias THEN before prod -- so a false-block can never reach users, and the bias is the fallback exactly when warranted). In-code visibility hardened: startA11yTrustChecks now states the one false-block path plainly, that the protection is the release process, that #2189 confirms the under-tmux surface has real fresh-install trouble, and that switching to a bias re-opens the decision.
- [NIT] stale #1214/#1940 step-5 comment described the removed "anytime in Settings" sentence as current. --> FIXED: rewritten as history superseded by #2125.
- [NIT] literal 5/6 for the a11y step. --> FIXED: added FR_STEP_A11Y for the a11y-poll stop guard (matching FR_STEP_YOU's guard usage); the ordered frGo ladder stays literal.
- [NIT] FORCE_TRUSTED=1 defeats the gate in prod — DUPLICATE of iteration 3's mock-seam NIT; reviewer notes no action needed given precedent.

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | BLOCKER | web.firstrun-a11y-1214.test.js | 3 #1214 tests red vs the #2125 gate | FIXED | reconcile commit |
| 2 | 2 | WARNING | native-app/main.swift | under-tmux spawn path untested | FIXED | iter-2 commit |
| 3 | 2 | NIT | native-app.a11y-writer-2125.test.js | dead fn slice | FIXED | iter-2 commit |
| 4 | 2 | NIT | web/index.html | soft-open undocumented | FIXED | iter-2 commit |
| 5 | 3 | NIT | native-app/main.swift | currentlyTrusted ignored staleness | FIXED | iter-3 commit |
| 6 | 3 | NIT | native-app/main.swift | FORCE_TRUSTED live seam | DEFERRED | release-binary build smoke needs it |
| 7 | 3 | NIT | tools/build-kosmos-bundle.sh | axprompt dialog on build host | DEFERRED | benign on cut machines |
| 8 | 4 | WARNING | native-app/main.swift | false-block safety is release-gated, not in-code | DEFERRED | Splinter ruled: real writer + hard promote gate + fix-or-bias-if-verify-fails; in-code visibility hardened |
| 9 | 4 | NIT | web/index.html | stale #1214 comment | FIXED | post-rebase commit |
| 10 | 4 | NIT | web/index.html | literal a11y step number | FIXED | post-rebase commit (FR_STEP_A11Y) |

### Outstanding questions (ASKED, still unresolved)
None. The iteration-4 WARNING was surfaced to Splinter as a decision flag and RULED (real writer, no bias) before convergence.

### Strengths (across iterations)
- Fail-safe integrity holds end to end: the ONLY state that disables Continue is a positive checkable:true+trusted:false; every uncheckable/stale/malformed/fetch-error state leaves Continue enabled. The single false-block path is a genuinely-wrong attribution, gated by the deferred fresh-install verify (now Splinter's hard promote gate).
- The cross-language path seam is correct across all three resolution arms and doubly pinned (source-wiring test + mock shell test), verified byte-identical by compiling and reading back through the engine.
- The mock shell test is honest and non-vacuous: real compiled binary, both trust states through the engine, the absent fail-safe control, the real under-tmux private-socket spawn, and a count floor.
- The three-answers discipline is consistent across engine, route, frontend poll, and browser check (whose ENABLED arms are genuine controls), and the frontend generation/timer contract mirrors the existing FR_YOU_GEN pattern.

## 🛑 DEFERRED FRESH-INSTALL GATE (Splinter's hard prod-promote gate; to flag on #2125)
The under-tmux attribution (does the AX read report tmux's trust or the app's?) is UNVERIFIED. NO #2125-carrying build promotes to prod until a FRESH macOS install confirms the writer does NOT false-block: granting Tmux flips the reading to trusted and unblocks Continue, and an ungranted Tmux blocks with the pane's guidance. DEFINED FAILURE ACTION if the verify shows a false-block: do NOT promote -- fix the attribution, OR apply the bias-to-trusted mitigation THEN, before prod. #2189 (Open-Accessibility surfaces no Tmux to enable) is the confirmed sibling issue on the same under-tmux surface.
