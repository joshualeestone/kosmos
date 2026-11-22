---
pre_challenge: true
method: challenge-loop
branch: homer-win-crossport-6916
diff_hash: aba889d17fe9420fdbbb190b86b3d67fa71b7d649cb4020324748bc4cc7896f5
validation: failed (helper unavailable on this box: no npm/yarn on PATH for the repo's type-check step, which is a no-op echo; validated instead each round by rebuild + sign + verify-launcher.ps1 OK, the live rig, and every affected and policy test file with the no-schtasks preload, all green, listed below)
subdir_audit: passed
timestamp: 2026-11-22T21:37:05Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped at the fleet's 8-round cap with no BLOCKER open, per the standing fleet rule "stop challenge loops at 8 rounds unless a BLOCKER is open; WARNINGs to a card". Round 8's two WARNINGs were measured and carried to kosmos#8909 (claimed by Homer).
**Total findings:** 3 BLOCKERs, 12 WARNINGs, 1 CONVENTION, plus NITs (per iteration below)
**Fixed:** all BLOCKERs and all WARNINGs from iterations 1-7 | **Carried to #8909:** iteration 7's WebSocket reasoning (docs corrected) and iteration 8's two WARNINGs | **Asked:** 0

### Validation run each round (this Windows box)
- `trial-6916/rebuild.sh`: pinned csc build, signed (Kosmos Agent Manager, Inc., timestamped), `verify-launcher.ps1` OK, live rig: fetch/img/navigation to another 127.0.0.1 port carry nothing (control with the served exe: all three carry the session)
- Final: tools.win32-launcher-crossport-6916 5/5, tools.win-launcher-native 30/30, reproof-6882 26/26, computer-mode-4381 16/16, connect-update-4382 13/13, signin-6512 10/10, open-board-2007 25/25, engine.reachable 8/8, windows-tests-1777 24/24, fixture-discipline 20/20, no-name-refs-3071 4/4, win32-separator-guard 4/4, windows-coupling-audit-1732 8/8

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 1 BLOCKER, 3 WARNINGs, 2 NITs
- [BLOCKER] KosmosLauncher.cs — check wired only when the window starts outside connect mode; RunAgentsHere/PageChoseMode switch a connect window to this computer's board unchecked --> FIXED (13cf80883a): wired in every mode
- [WARNING] test locked in the mode exemption --> FIXED (13cf80883a)
- [WARNING] plan/README assumed mode never changes --> FIXED (13cf80883a)
- [WARNING] worker requests not covered by the document filter --> FIXED as documentation (sw.js passes other origins); later pinned by a test (iteration 6)
- [NIT] comment block placement; [NIT] WebSocket residual only in the plan --> FIXED (13cf80883a)

#### Iteration 2
**New findings:** 1 BLOCKER, 3 WARNINGs, 2 NITs
- [BLOCKER] KosmosLauncher.cs — an address .NET Uri cannot parse (>~65.5k chars) was let through; Chromium sends up to 2 MB --> FIXED (a00b231798, a9b3457786): read by scheme://host:port, else refused; control against the earlier code confirmed the hole
- [WARNING] redirects unmeasured --> MEASURED: refused with the fix, leak with the control (no code change needed)
- [WARNING] large-upload cost unmeasured --> MEASURED: 50 MB 0.1 s -> 0.7 s, accepted and documented
- [WARNING] clicked link to a dev site still opens in the browser? --> documented reasoning (NavigationStarting still cancels: window kept the board page)
- [NIT] mode-gate test scope; [NIT] loopback alias cases --> FIXED
- Side fix: an array literal broke verify-launcher's reproducible build --> FIXED (a9b3457786)

#### Iteration 3
**New findings:** 0 BLOCKERs, 2 WARNINGs, 3 NITs
- [WARNING] service-worker-controlled page unmeasured --> MEASURED (rig-sw.js): refused with the fix, leak with the control
- [WARNING] board's own media/download unmeasured --> MEASURED (rig-board.js): Range 206 and downloads unchanged
- [NIT] comment scope of spellings; [NIT] fail-closed wording; [NIT] COM wrapper release --> FIXED (9e831a24e4)

#### Iteration 4
**New findings:** 0 BLOCKERs, 1 WARNING, 3 NITs
- [WARNING] "*" filter buffers every request, a connect window's remote uploads included --> FIXED (4885947a48): substring filters for 127.0.0.1/localhost/[::1]; measured that 127.1, 2130706433, 0x7f.1 are rewritten first and blocked, redirects still blocked
- [NIT] test header; [NIT] args wrapper; [NIT] comment sentence --> FIXED

#### Iteration 5
**New findings:** 0 BLOCKERs, 1 WARNING, 2 NITs
- [WARNING] a 403 factory that does not work fails open; plan claimed the wiring caught it --> FIXED (6ef00abb6c): throwaway refusal at wiring, window closes on failure
- [NIT] filter/comment scope; [NIT] over-exact source assertions --> FIXED

#### Iteration 6
**New findings:** 0 BLOCKERs, 1 WARNING, 4 NITs
- [WARNING] nothing pins web/sw.js passing other origins --> FIXED (ad45553a95): test fails if sw.js answers another origin itself
- [NIT] UI-thread queueing; [NIT] "never held" wording; [NIT] unused variable; [NIT] board definition --> FIXED

#### Iteration 7
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION-level NIT, 5 NITs
- [WARNING] WebSocket reasoning wrong: the cookie is HttpOnly, so a WebSocket hands the token itself out --> docs CORRECTED (bcfcafe3c9); the browser-level block carried to #8909
- [NIT] x6 (comments, null-refusal path listed, sw.js test, README wrap, plan items merged) --> FIXED

#### Iteration 8 (cap)
**New findings:** 0 BLOCKERs, 2 WARNINGs, 2 NITs
- [WARNING] shared-worker requests not covered --> MEASURED (rig-shw.js): leaks with the fix and the control; CARRIED to #8909 and named in comment/README/plan (4b8e2f8145)
- [WARNING] WebSocket gap untracked by number --> FIXED: kosmos#8909 filed, claimed, named in comment/README/plan (4b8e2f8145)
- [NIT] plan "no hole today" too strong --> FIXED (4b8e2f8145)
- [NIT] clicked-link check only inferred --> carried (not driven with a real click, to avoid opening tabs in the person's browser)

### Final Ledger

| # | Iter | Category | Description | Status | Resolution |
|---|------|----------|-------------|--------|------------|
| 1 | 1 | BLOCKER | mode-gated check missed connect->run switch | FIXED | 13cf80883a |
| 2 | 2 | BLOCKER | unparseable long address let through | FIXED | a00b231798 / a9b3457786 |
| 3 | 2 | BLOCKER-class (own) | array literal broke reproducible build | FIXED | a9b3457786 |
| 4 | 1 | WARNING | test locked mode exemption | FIXED | 13cf80883a |
| 5 | 1 | WARNING | docs assumed fixed mode | FIXED | 13cf80883a |
| 6 | 1 | WARNING | worker requests | FIXED (doc + test) | 13cf80883a, ad45553a95 |
| 7 | 2 | WARNING | redirects | MEASURED blocked | rig-redirect.js |
| 8 | 2 | WARNING | upload cost | MEASURED, accepted | rig-upload.js |
| 9 | 3 | WARNING | service worker page | MEASURED blocked | rig-sw.js |
| 10 | 3 | WARNING | board media/downloads | MEASURED unchanged | rig-board.js |
| 11 | 4 | WARNING | "*" filter holds all traffic | FIXED | 4885947a48 |
| 12 | 5 | WARNING | broken 403 factory fails open | FIXED | 6ef00abb6c |
| 13 | 6 | WARNING | sw.js assumption unpinned | FIXED | ad45553a95 |
| 14 | 7 | WARNING | WebSocket hands out HttpOnly token | CARRIED | #8909 |
| 15 | 8 | WARNING | shared worker leaks | CARRIED (measured) | #8909 |
| 16 | 8 | WARNING | gap untracked | FIXED | #8909 filed |

### Outstanding questions (ASKED)
None.

### Carried to kosmos#8909 (not fixed in this branch)
- A WebSocket the page opens, and a shared worker's own requests, still carry the HttpOnly session to another port (both measured). Both need script running in the board page.

### Strengths (across all iterations)
- COM declarations checked slot by slot against WebView2.h by every round
- Every failure path closes: wiring failure -> browser fallback before any load; unreadable request refused; throwaway refusal at start
- Each claim backed by a live rig run with a control against the served exe
