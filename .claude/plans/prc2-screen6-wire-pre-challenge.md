---
pre_challenge: true
method: challenge-loop
branch: prc2-screen6-wire
diff_hash: 255c75e3e63e2f187fbfcbe07f6dec239bfc90c2b722de1630ea3843455127ee
validation: passed
subdir_audit: passed
timestamp: 2026-09-06T05:26:04Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3 returned zero BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 3 WARNINGs, 4 NITs (0 BLOCKERs, 0 CONVENTIONs)
**Fixed:** 3 WARNINGs + 2 NITs | **Deferred:** 2 NITs | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 NIT
- [WARNING] web.firstrun-consent-prc2.test.js — the keyboard-binding assertion grepped the whole page, so it passed regardless of whether the S6 switches were keyboard-operable (vacuous a11y check) --> FIXED (c68d231a): replaced the source-grep behavior arms with RUNTIME arms (lift the S6 block, run against a DOM stub + mocked fetch).
- [WARNING] web/index.html — the toggle/refresh control flow (optimistic flip, revert, epoch, re-entrancy, never-false-Off) was pinned only by source-grep --> FIXED (c68d231a): runtime arms now exercise the flip, the revert on non-ok/thrown PUT (perturb-verified), refresh painting, and keyboard.
- [NIT] in-flight clicks dropped by the SAVING guard --> DEFERRED (by design; protects against interleaved PUTs).
- Initial-validation also caught the #1720 browser-check gate; resolved with an honest `Browser-check:` trailer (runtime test + live paint verified in the 6.38 staging cut; in-suite render check a tracked follow-up).

#### Iteration 2
**New findings:** 0 BLOCKERs, 1 WARNING, 2 NITs
- [WARNING] the FR_*_EPOCH stale-response guard and FR_*_SAVING re-entrancy guard were never exercised --> FIXED (8953fca3): added two perturb-verified runtime arms (a superseded slow refresh must not repaint; a second toggle while a PUT hangs is dropped to one PUT/one flip, fired without await so a regression fails cleanly rather than hanging).
- [NIT] the revert arms did not assert a PUT was attempted --> FIXED (8953fca3): both now assert a PUT reached the backend before the revert.
- [NIT] region end-slice assumes the ping wire is the last statement before the IIFE close --> DEFERRED (low risk, locates by content, survives the block moving).

#### Iteration 3
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 new NIT (+ 1 duplicate-deferred)
- [NIT] the epoch counter is intentionally shared across read (refresh) and write (toggle), unremarked --> FIXED (dd545bfb): added a one-line comment (no behavior change).
- [NIT] region end-slice (duplicate of iteration 2's, still DEFERRED).
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | WARNING | web.firstrun-consent-prc2.test.js | vacuous whole-page keyboard assertion | FIXED | c68d231a |
| 2 | 1 | WARNING | web/index.html | control flow only source-grepped | FIXED | c68d231a |
| 3 | 1 | NIT | web/index.html | SAVING drops in-flight double-clicks | DEFERRED | by design |
| 4 | 2 | WARNING | web.firstrun-consent-prc2.test.js | epoch + SAVING guards never exercised | FIXED | 8953fca3 |
| 5 | 2 | NIT | web.firstrun-consent-prc2.test.js | revert arms didn't assert a PUT | FIXED | 8953fca3 |
| 6 | 2 | NIT | web.firstrun-consent-prc2.test.js | region end-slice assumes wire is last | DEFERRED | low risk, content-located |
| 7 | 3 | NIT | web/index.html | shared epoch unremarked | FIXED | dd545bfb |

### Outstanding questions (ASKED, still unresolved)
None.

### NITs (non-blocking)
- SAVING drops in-flight double-clicks (deferred, by design).
- region end-slice assumes the ping wire is last before the IIFE close (deferred, low risk).

### Strengths (across all iterations)
- The runtime test lifts the shipped source region and runs it against DOM/fetch stubs, exercising real control flow rather than matching text; assertions are non-vacuous and can fail; each load() re-evals fresh so state does not leak.
- "Never a false Off" is implemented on every failure path (non-ok revert, thrown revert, non-boolean payload skip); backend contract verified GET/PUT {on:boolean} against server.js.
- The epoch and re-entrancy arms are deterministic (sync-before-first-await + deferred() control ordering) and perturb-proof (removing either guard fails its arm cleanly).
- No global-scope collisions (eleven new names each declared once); no em dashes in added lines; a11y sound (role=switch, aria-checked, tabindex, click+Space/Enter+preventDefault); the Browser-check: trailer is honest and names the in-suite render check as a tracked follow-up.
