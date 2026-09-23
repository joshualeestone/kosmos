---
pre_challenge: true
method: challenge-loop
branch: demo-scenario-718
diff_hash: 7484d6b2027905ce3f4c6df95af77da6ef80be899cba461ea069c8187558e617
validation: passed
subdir_audit: passed
timestamp: 2026-09-23T04:29:57Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (plus the 6.0 initial-validation pass, which failed and seeded synthetic findings)
**Converged:** Yes (iteration 3 found zero BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 8 (2 BLOCKERs, 1 WARNING, 1 CONVENTION, 4 NITs; STRENGTHs not counted)
**Fixed:** 6 | **Deferred:** 2 (pageerror/console listener; icon pixel-dimension check) | **Asked:** 0

Model rotation (kosmos#2032): opus, sonnet, opus. Sonnet (iter 2) independently
confirmed the README-index BLOCKER the 6.0 validation surfaced and additionally
caught the stale plan-token WARNING and the overlapping-icon-findings NIT; opus
(iters 1, 3) caught the inert surface token and the missing harness catch, and
verified convergence.

This branch adds ONE new browser-check and its wiring, so the loop's real work
was making the new check conform to the repo's browser-check contracts, which are
enforced by tests: the reason-grep emit-site count, the README-names-every-script
index, and the surface-token convention. Every finding was one of those contracts.

### Per-Iteration Breakdown

#### 6.0 Initial validation (counts as iteration 1 for the valve)
**FAILED** (rc=1): two node --test failures, both caused by the new check.
- [BLOCKER] browser-checks-reason-grep.test.js — EXPECTED_SITES was 123, the new check added a SHAPE-1 FAIL-emit site --> FIXED (b7daa0d2)
- [BLOCKER] browser-checks-indexed.test.js — the README does not name render-pwa-installable-718.js --> FIXED (fe70403c, iter 2)
Both Origin BRANCH (helper/test-assertion failures cite no blame line).

#### Iteration 1
**Reviewer model:** opus (ran in parallel with 6.0)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 1 NIT
**Self-generated:** 0 (ITER_COMMITS empty at this point)
- [CONVENTION] render-pwa-installable-718.js:1 — surface tag led with `pwa-installable-718`, which has 0 hits in web/index.html (convention: tokens are real index.html markers) --> FIXED (b7daa0d2, dropped it; kept `manifest apple-touch-icon`)
- [NIT] render-pwa-installable-718.js — no top-level harness `.catch` (siblings print a diagnosable FAIL line on board-down) --> FIXED (b7daa0d2, added a single-line quotable catch)
Iter-1 fixes also bumped EXPECTED_SITES 123->125 and EXPECTED_CATCH_SITES 89->90 (the FAIL loop + the new catch, both quotable; MEASURED).

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 1 WARNING, 2 NITs
**Self-generated:** 0 (the README absence and the plan line both predate the loop's fix commits; BRANCH)
- [BLOCKER] docs/browser-checks/README.md — render-pwa-installable-718.js not named (browser-checks-indexed.test.js) --> FIXED (fe70403c, added a "PWA installability (#718)" section). Same defect as the 6.0 README failure, independently found.
- [WARNING] plan Verification — claimed the bc-surface-map tokens still included `pwa-installable-718`, stale after iter-1 dropped it --> FIXED (fe70403c, corrected to `manifest apple-touch-icon`)
- [NIT] render-pwa-installable-718.js — empty manifest.icons produced 3 overlapping FAIL lines --> FIXED (fe70403c, guarded the 192/512 checks behind icons-present)
- [NIT] render-pwa-installable-718.js — no pageerror/console listener on load --> DEFERRED (this check's subject is static HTML — manifest/icons/head metas — independent of board JS; a load-time JS error is out of scope and a console listener risks false-reds on unrelated board noise)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0
**Converged** — zero actionable findings. Verified the negative control fires live, the two MEASURED constants match reality, the gated spec is honest, and no existing check is masked.
- [NIT] render-pwa-installable-718.js — icon-resolve does not verify actual pixel dimensions match declared sizes --> DEFERRED (reviewer states no change required: out of scope for install eligibility, which trusts the manifest declaration; already framed in the plan's weakest-reasoning)

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 6.0 | BLOCKER | browser-checks-reason-grep.test.js | BRANCH | EXPECTED_SITES count stale for new emit site | FIXED | b7daa0d2 |
| 2 | 6.0 | BLOCKER | docs/browser-checks/README.md | BRANCH | README does not name the new check | FIXED | fe70403c |
| 3 | 1 | CONVENTION | render-pwa-installable-718.js:1 | BRANCH | Inert surface token (0 index.html hits) | FIXED | b7daa0d2 |
| 4 | 1 | NIT | render-pwa-installable-718.js | BRANCH | No harness .catch | FIXED | b7daa0d2 |
| 5 | 2 | WARNING | plan Verification | BRANCH | Stale bc-surface-map token claim | FIXED | fe70403c |
| 6 | 2 | NIT | render-pwa-installable-718.js | BRANCH | Overlapping empty-icon findings | FIXED | fe70403c |
| 7 | 2 | NIT | render-pwa-installable-718.js | BRANCH | No pageerror/console listener | DEFERRED | Out of scope (static-HTML subject) |
| 8 | 3 | NIT | render-pwa-installable-718.js | BRANCH | Icon pixel dims unchecked | DEFERRED | Out of scope for eligibility |

### Outstanding questions (ASKED)
None.

### NITs (non-blocking)
- No pageerror/console listener (deferred; static-HTML subject).
- Icon pixel dimensions unverified (deferred; eligibility trusts the manifest declaration).

### Strengths (across all iterations)
- The negative control is real doctrine and armed: it runs first, targets the same `/icons/` route family, and was verified to fire live (absent path -> 404); a failed manifest fetch still records a problem, so icon checks cannot silently false-pass, and an HTML fallback would fail both JSON.parse and the image/* guard. Grounded in a real, previously-fixed server defect (server.js's /icons/ 404 route).
- Gated-spec honesty: steps (2)-(4) of the demoable flow are documented as GATED on dependencies confirmed absent from kosmos origin/main (service worker, kosmos-relay push, front-door #2854), so no unarmed guard ships for a nonexistent flow while "demoable" gets one discoverable in-repo definition.
- Both MEASURED emit-site constants verified consistent with the check's actual emit sites; no existing check masked; read-only, correctly placed in the shared $B8 board group; both surface tokens genuinely present in web/index.html; README/plan/code mutually consistent.
- The measure-before-build recon corrected two wrong premises (the repo uses docs/browser-checks, not .claude/browser-test-scenarios.md; the push path is unbuilt) before any code was written.
