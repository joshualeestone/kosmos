---
pre_challenge: true
method: challenge-loop
branch: launcher-rebuild-6512
diff_hash: aa29c3e41746e21e3cee99fd5ba6a24f05f984e0fcaafd5eaa45a23ce331a7b9
validation: failed (environment: the validation helper needs yarn or npm, and neither is on this Windows box; substitute run below)
subdir_audit: passed
timestamp: 2026-10-19T13:55:07Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7
**Converged:** Yes (iteration 7 returned NITs only)
**Total findings:** 37 (0 BLOCKERs, 12 WARNINGs, 3 CONVENTIONs, 22 NITs)
**Fixed:** 13 | **Deferred:** 2 | **Asked (awaiting user):** 0

**Validation, stated honestly.** `validation_log_run_or_skip` exited 1 at 6.0 and at 6j for one reason only: it
runs the repo's yarn/npm sequence and this Windows box has neither (no install was made). Substitute, on the
final HEAD with the schtasks-blocking preload: `node tools/windows-tests.js` 181 of 182 files pass; the one red,
engine/setupsettings.fsync-5434.test.js, is a file this branch does not touch and fails the same way when run
alone on this box. The launcher test files (tools.win-launcher-*, tools.windows-computer-mode-4381,
tools.build-windows-*, web.signin-again-6358, tools.win-staging-verify) all pass. verify-launcher.ps1 reports OK
on the final exe. The full `yarn test` suite is left to CI.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 4 NITs
- [WARNING] KosmosLauncher.cs PageSaysSignedOut: auto sign-in lands on the front page, the Mac keeps the page --> FIXED (a2dc40481, SignInAgainAddress)
- [WARNING] tools.win-launcher-signin-6512.test.js: git-order test reds source-only PRs, not written down --> FIXED (a2dc40481, README + plan)
- [WARNING] KosmosLauncher.cs: give-up has no visible effect on Windows --> DEFERRED: the Windows panel always says to open Kosmos.exe again; the launcher has no log; recorded in plan and comment
- [CONVENTION] web/index.html:24481 stale comment says Kosmos.exe does not answer --> FIXED (a2dc40481, Browser-check trailer)
- [NIT] 4381 message backwards; tries-1 edge; token read failure; no refused input --> FIXED (a2dc40481)

#### Iteration 2
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 5 NITs
- [WARNING] build-kosmos-windows.sh: drift check ignores assets/kosmos.ico --> FIXED (ed9f50aa9)
- [NIT] shallow clone comment wrong; only boot taken from fresh; escaped path probe; plan stale --> FIXED (ed9f50aa9)
- [NIT] retry the token read --> superseded by iteration 3

#### Iteration 3
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
- [WARNING] one failed board.token read gives up for good --> FIXED (293a9674c, no haveToken input)
- [NIT] encoded names pass the filter; count-before-navigate comment; probe check order; README fetch-depth --> FIXED (293a9674c)

#### Iteration 4
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 3 NITs
- [CONVENTION] plan says ReadBoardToken count 5 -> 6, HEAD says 5 --> FIXED (0971248ac)
- [WARNING] order-only check misses an exe built from other source --> FIXED (0971248ac, README)
- [NIT] 4381 message; not-confirmed branch drops keepPage --> FIXED (0971248ac)
- [NIT] duplicate connect check --> not changed (defence in depth)

#### Iteration 5
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
- [WARNING] verify-launcher.ps1 on CI runners unproven, could red every PR --> FIXED (27bdcb6ff, skipped on GITHUB_ACTIONS)
- [WARNING] cross-lane process cost not quantified --> FIXED (27bdcb6ff, plan)
- [NIT] fragment dropped; accepted-cost comment; WndProc-scoped test --> FIXED (27bdcb6ff)
- [NIT] double-click does not stamp the pacing clock --> deferred (bounded by the cap; plan)

#### Iteration 6
**New findings:** 0 BLOCKERs, 1 WARNING (1 duplicate), 0 CONVENTIONs, 4 NITs
**Duplicates of prior findings:** 1 (cross-lane gate, iteration 5)
- [WARNING] the cut never runs the byte compare --> FIXED (1add15ff5, RELEASING step 3 runs verify-launcher.ps1; 0d70ad57f plan)
- [NIT] git failure read as drift; reload cost undocumented; vacuous assert; brittle 4381 regex --> FIXED (1add15ff5)

#### Iteration 7
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | KosmosLauncher.cs PageSaysSignedOut | front page instead of kept page | FIXED | a2dc40481 |
| 2 | 1 | WARNING | tools.win-launcher-signin-6512.test.js | PR gate not documented | FIXED | a2dc40481 |
| 3 | 1 | WARNING | KosmosLauncher.cs | give-up invisible | DEFERRED | panel already says the remedy; no launcher log |
| 4 | 1 | CONVENTION | web/index.html:24481 | stale comment | FIXED | a2dc40481 |
| 5 | 2 | WARNING | build-kosmos-windows.sh | icon not covered | FIXED | ed9f50aa9 |
| 6 | 3 | WARNING | KosmosLauncher.cs SignInAgainDecision | one bad token read gives up for good | FIXED | 293a9674c |
| 7 | 4 | CONVENTION | plan | stale ReadBoardToken count | FIXED | 0971248ac |
| 8 | 4 | WARNING | build-kosmos-windows.sh | order-only check | FIXED | 0971248ac |
| 9 | 5 | WARNING | tools.win-launcher-signin-6512.test.js | unproven CI byte compare | FIXED | 27bdcb6ff |
| 10 | 5 | WARNING | README | cross-lane cost | FIXED | 27bdcb6ff |
| 11 | 6 | WARNING | build-kosmos-windows.sh / RELEASING.md | cut runs no byte compare | FIXED | 1add15ff5 |
| 12 | 6 | WARNING | tests | cross-lane gate | DEFERRED | duplicate of #10, recorded in plan |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, open at the end)
- [NIT] tools/windows/README.md:432 one line wraps past 80 columns (iteration 7)
- [NIT] KosmosLauncher.cs:3618 comment line breaks early (iteration 7)
- [NIT] KosmosLauncher.cs:3626 double-click does not stamp lastSignInAgainAt, no code comment (iteration 7; plan records it)
- [NIT] tools.win-launcher-signin-6512.test.js:235 skip reason when the probe fails to compile (iteration 7)
- [NIT] KosmosLauncher.cs duplicate connect check (iteration 4, kept as defence in depth)

### Strengths (across all iterations)
- SignInAgainDecision is a pure, probe-tested port of the Mac's decision; the page's retell (65 s) is pinned above the window's gap (60 s)
- The sign-in message is heard only from the board's own page, after the connect return; no token ever goes into an address
- SignInAgainAddress keeps the page on the nonce's own host, drops stale sign-in items by decoded name, and puts the fresh nonce first
- The drift tripwire runs at the cut and on every PR, covers the icon, and tells git failing apart from drift
