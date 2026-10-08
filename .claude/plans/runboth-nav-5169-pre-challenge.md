---
pre_challenge: true
method: challenge-loop
branch: runboth-nav-5169
diff_hash: c84e8a31e0e634600d2cf7141509a726ffbf9ad9bf99471d1679e0797f68e46e
validation: passed
subdir_audit: passed
timestamp: 2026-10-07T13:00:55Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (reviewer models rotated: opus, sonnet, opus)
**Converged:** Yes (iteration 3 found zero new actionable findings after deduplication)
**Total findings:** 12 actionable (4 BLOCKERs, 6 WARNINGs, 2 CONVENTIONs) + NITs/STRENGTHs
**Fixed:** 5 | **Deferred:** 7 | **Asked (awaiting user):** 0

The vary-model rule earned its keep here: iteration 2 (sonnet) found 3 suite-breaking BLOCKERs
that iteration 1 (opus) missed entirely, and a targeted grep then surfaced a 4th stale pin the
blind reviewers missed.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 0 NITs
**Self-generated:** 0 of the above (ITER_COMMITS empty; nothing committed yet)
- [CONVENTION] .claude/plans/ — No plan file for this branch --> FIXED (commit 1c6a3eb9c; plan copied in from the agent's Notes, with the stale `env -u` command corrected to `unset`)
- [WARNING] native-app/main.swift:346 — the unclicked-foreign `.block` also changes connect mode --> DEFERRED (intended; the only unclicked foreign hand-off, site->Stripe, is preserved via `isKosmosPlusSiteURL`; board pages correctly `.block`; Sonya-approved; plan steps 2a/6 flag it for sign-off)
- [WARNING] native-app.runboth-nav-5169.test.js — structural-only (regex vs source) --> DEFERRED (by-design and documented; behavioral coverage is `--kosmos-app-mode-selftest` at bundle build, verified green; the decision logic is Swift and cannot run in the JS suite)

#### Iteration 2
**Reviewer model:** sonnet (different model from iteration 1, per 6a)
**New findings:** 3 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above (iter-1's only commit added a `.md` plan file; no finding lands on those lines)
**Duplicates of prior findings (confirmed resolved):** 0
- [BLOCKER] native-app.computer-mode-4356.test.js:245 — pins the OLD nav guard `computerMode == .connect`; the change rewrote it to `connect || run || both` --> FIXED (commit cb59980e1)
- [BLOCKER] native-app.computer-mode-4356.test.js:247 — pins the OLD call `connectLinkDecision(for:clicked:)`; the handler now passes `board:` and `fromKosmosPlusPage:` --> FIXED (commit cb59980e1)
- [BLOCKER] native-app.computer-mode-4356.test.js:271 — pins `let expected = 86`; the selftest is now 98 rows --> FIXED (commit cb59980e1; header "86 rows" also updated, and the now-false "a run computer is unchanged" title/message)
- [WARNING] tools.windows-computer-mode-4381 — Mac/Windows connect-policy divergence --> DEFERRED (verified in KosmosLauncher.cs: Windows run/both already cancels in-window foreign nav and opens it in the browser, so it is NOT vulnerable to #5169; the divergence is only browser-vs-block for unclicked foreign; surfaced to Liu Kang as a possible comment-parity follow-up)
- [WARNING] native-app/main.swift:3586 — createWebViewWith new-window still connect-only --> DEFERRED (out of main-frame scope; run/both new windows all route to the browser, which is safe; pre-existing design, not touched by #5169)
- [WARNING] native-app/main.swift:2836 — run/both unclicked foreign (OAuth/provider), and localhost vs 127.0.0.1 --> DEFERRED (only the site->Stripe scripted hand-off is preserved; clicked links go to the browser; the local board is ALWAYS addressed as 127.0.0.1, so a localhost redirect is correctly a foreign origin)
- [WARNING] native-app/main.swift:328 — board match accepts http and https --> DEFERRED (minor, test-path only via KOSMOS_URL; no security impact)
- [NIT] isKosmosPlusSiteURL duplicates isKosmosPlusURL guards --> kept (the file's deliberate "a copy, not shared code: the selftest rows pin it" convention)

A targeted grep after iteration 2 found a 4th stale pin the blind reviewers missed:
- [BLOCKER] native-app.download-5167.test.js:110 — pins `let expected = 86` for the mode-check --> FIXED (commit 87a6f18e3; download rows themselves unchanged at 29)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs (every item was a duplicate of an existing ledger entry)
**Self-generated:** 0 of the above
**Duplicates of prior findings (confirmed resolved):** all (connect-mode change #2, Mac/Windows parity #7, structural-test #3, board http/https #10, isKosmosPlusSiteURL dup NIT). The reviewer independently ran the 3 updated tests (5/30/29 pass, 0 fail) and traced every selftest row as correct.
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | CONVENTION | .claude/plans/ | BRANCH | No plan file for this branch | FIXED | 1c6a3eb9c |
| 2 | 1 | WARNING | native-app/main.swift:346 | BRANCH | unclicked-foreign `.block` also changes connect | DEFERRED | intended; site->Stripe preserved; board pages block; Sonya-approved; flagged for sign-off |
| 3 | 1 | WARNING | native-app.runboth-nav-5169.test.js | BRANCH | structural-only test | DEFERRED | by-design; behavioral gate is the build selftest (green) |
| 4 | 2 | BLOCKER | native-app.computer-mode-4356.test.js:245 | BRANCH | old nav guard regex | FIXED | cb59980e1 |
| 5 | 2 | BLOCKER | native-app.computer-mode-4356.test.js:247 | BRANCH | old call-signature regex | FIXED | cb59980e1 |
| 6 | 2 | BLOCKER | native-app.computer-mode-4356.test.js:271 | BRANCH | expected = 86 (now 98) | FIXED | cb59980e1 |
| 7 | 2 | WARNING | tools.windows-computer-mode-4381.test.js | BRANCH | Mac/Windows policy divergence | DEFERRED | Windows not vulnerable (cancels+browser); cosmetic parity follow-up; surfaced to Liu Kang |
| 8 | 2 | WARNING | native-app/main.swift:3586 | BRANCH | createWebViewWith new-window connect-only | DEFERRED | out of main-frame scope; run/both new windows all route to browser (safe) |
| 9 | 2 | WARNING | native-app/main.swift:2836 | BRANCH | run/both unclicked foreign; localhost vs 127.0.0.1 | DEFERRED | site->Stripe preserved; board always 127.0.0.1 so localhost correctly foreign |
| 10 | 2 | WARNING | native-app/main.swift:328 | BRANCH | board match accepts http and https | DEFERRED | minor, test-path only (KOSMOS_URL); no security impact |
| 11 | 2 | WARNING | native-app/main.swift:301 | BRANCH | row count only build-confirmed | DEFERRED | re-run on this head: mode-check all good (98 rows), exit 0 |
| 12 | 2 | BLOCKER | native-app.download-5167.test.js:110 | BRANCH | expected = 86 (now 98) | FIXED | 87a6f18e3 (found by targeted grep) |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- isKosmosPlusSiteURL re-derives the apex + repeats the host-vetting preamble of isKosmosPlusURL (iters 1-3) — kept per the file's "a copy, not shared code: the selftest rows pin it" convention.
- The download selftest control was reworded rather than flipped to an expectation (plan step 3) — deliberate: it runs in `computerMode .unset`, where the guard falls through to `.allow`, so the control stays non-vacuous (confirmed by reading the mode).

### Strengths (across all iterations)
- The `isKosmosPlusSiteURL` vs `isKosmosPlusURL` split is the security crux and is correct: keying the Stripe-checkout exception on the SITE (login/apex), not on the computer-board predicate, stops a board page (`<name>.kosmosplus.com` or `127.0.0.1:port`) claiming the exception to script a foreign nav away.
- Board-aware rule reuses the existing `badgeOrigin` rather than reintroducing #5188's parallel `isBoardURL`, as the plan required.
- The `#5169 MERGE GATE` selftest row is non-vacuous (fails on the pre-fix `clicked ? .browser : .block` logic). Row-count accounting (86 -> 98, +12) is exact and both companion tests were updated in lockstep.
