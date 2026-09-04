---
pre_challenge: true
method: challenge-loop
branch: openai-only-banner-2096
diff_hash: 1714181cb36bd5b77a655813b551366ba1dde1b2c64ec9992db12735adc9bb9b
validation: passed
subdir_audit: passed
timestamp: 2026-09-04T02:53:17Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes — the first blind review found zero BLOCKER/WARNING/CONVENTION (3 STRENGTHs, 2 no-change-required NITs).
**Total findings:** 3 real (all in the 6.0 baseline: an enforced gate + two count tripwires) + 2 NITs.
**Fixed:** 3 | **Deferred:** 2 (NITs) | **Asked:** 0

Validation green. web.openai-only-banner-2096 5/5; server.depends-on-claude-2096 2/2;
the committed browser check reds on origin/main and passes on HEAD.

### Per-Iteration Breakdown

#### Iteration 1 — the 6.0 validation baseline: 3 real gate issues, all mine, all fixed
- [BLOCKER] browser-check gate (#1720) — a web/ change with no docs/browser-checks assertion.
  --> FIXED: added `render-openai-only-2096.js` (drives the real renderConnection into #conn),
  wired into tools/browser-checks.sh + README.
- [BLOCKER] browser-checks-reason-grep — the new check added one finding-emit + one catch/launch
  site, tripping the exact-count tripwires. --> FIXED: bumped EXPECTED_SITES 36->37 and
  EXPECTED_CATCH_SITES 18->19, both confirmed quotable (same shapes as render-account-badge-1921).

#### Iteration 2 — first blind review: CONVERGED (0 blocking, 2 NITs)
Three STRENGTHs confirmed: the HIDE direction is sound and unbreakable (a running Claude agent
can never be classified codex, so any real Claude usage leaves a trace; the strict `=== false`
means undefined/null/missing all fall through to WARN); `known`/`agents`/`offline` are all in the
same lexical block at the payload assembly (no ReferenceError; server test confirms real
/api/status values); the tests are non-vacuous and the browser check genuinely reds on origin/main.
- [NIT] `Array.isArray(known)` is defensively redundant --> DEFERRED: harmless; known is already an array.
- [NIT] a secondary `.claude-<label>` account with an absent default config makes dependsOnClaude
  true and shows the banner --> DEFERRED: the safe (over-warn) direction, matches the card's intent.

### Final Ledger
| # | Iter | Category | Description | Status |
|---|------|----------|-------------|--------|
| 1 | 1 | BLOCKER | browser-check gate #1720 (no assertion) | FIXED |
| 2 | 1 | BLOCKER | reason-grep emit-site count tripwires | FIXED |
| 3 | 2 | NIT | Array.isArray(known) redundant | DEFERRED |
| 4 | 2 | NIT | secondary Claude account over-warns | DEFERRED |

### Outstanding questions (ASKED)
None.

### Strengths
- The hide-direction is provably safe: only positively codex-only + no-Claude-account suppresses;
  missing/undefined field falls through to warning.
- The browser check reds on origin/main (renderConnection there ignores the 3rd arg), so it
  cannot pass against the pre-fix code.
- Server + frontend both covered by executing tests, not source pins.

### Cluster
#2097 (picker not provider-aware) + #2098 (Claude model under OpenAI key) are the same
provider-awareness family — natural next. #2095 (account-name) is Mona Lisa's.
