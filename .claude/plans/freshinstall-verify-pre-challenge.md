---
pre_challenge: true
method: challenge-loop
branch: freshinstall-verify
diff_hash: e9147ceb0f299abc2954ec21eb62fcf098f377b6df82e2de4746b012dc5037f1
validation: passed
subdir_audit: passed
timestamp: 2026-09-05T22:31:06Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3 returned zero actionable findings; the auth BLOCKER fix was confirmed correct)
**Total findings:** 5 (1 BLOCKER, 2 WARNINGs, 2 NITs)
**Fixed:** 5 | **Deferred:** 0 | **Asked:** 0

This is a documentation change (a fresh-install launch-verification runbook), so
the review was aimed at ACCURACY: every named browser-check must exist, every
served-API command must actually run against the served board, and every
precondition must not steer a verifier into a false PASS/FAIL. Every iteration
found a real accuracy defect, which is the point of reviewing a runbook.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
- [WARNING] the #2279 served check said `rm first-run.json` + empty projects is
  enough to see the seed, but `seedWelcomeHome` also gates on the once-EVER
  `seeded-project.json` flag, which `rm first-run.json` does NOT clear -> a
  once-onboarded-then-deleted store reads after=0 and a verifier files a false
  regression --> FIXED (10fc91fc): require a never-seeded store (full wipe / new
  account) and explain the flag.
- [NIT] "the provider-marks checks" was a generic descriptor where the doc names
  every other check by exact filename --> FIXED (10fc91fc): named the real files.

#### Iteration 2
**New findings:** 1 BLOCKER, 1 WARNING, 0 CONVENTIONs, 0 NITs
- [BLOCKER] the served-API recipe used a bare `curl`, but a served (non-sandbox)
  board enforces the board token: every `/api/*` without `x-kosmos-board-token`
  returns 403, and `grep -c` reads 0 off the 403 body -> all three commands
  produce a coherent "seed never fired" and a bogus #2279 regression --> FIXED
  (742760e8): lead with the board-UI check; for the API form, send the token
  OFF argv via `-H @file` (as the CLI's `kosmos_curl` does), resolve the address
  from `kosmos status` (not an assumed port), and add a `%{http_code}` must-be-200
  confirmation so a 403 is never mistaken for an empty result.
- [WARNING] the doc framed the `origin` header as what makes the POST succeed;
  that is necessary-not-sufficient (the token gate is separate) --> FIXED
  (742760e8) in the same rewrite.

#### Iteration 3
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
- [NIT] the explanation said the token gate refuses "before the cross-site check"
  / "refuses first"; in fact `crossSiteWrite` is evaluated before the token gate.
  No operational impact (a bare curl sends no Origin, so the token gate is the
  effective 403), only the internal-ordering prose was wrong --> FIXED (f7177bbf):
  removed the ordering assertion, kept "both gates must pass".
- **Converged** -- the auth BLOCKER fix was verified correct and complete (token
  path, header name, `kosmos status` URL, per-account port, off-argv `-H @file`,
  the 403 false-FAIL warning), all 17 named checks exist, and the #2279
  never-seeded precondition matches engine/projects.js. The only finding was the
  benign explanatory NIT above.

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | WARNING | docs/fresh-install-launch-verification.md | seed precondition missed the seeded-project.json flag | FIXED | 10fc91fc |
| 2 | 1 | NIT | docs/fresh-install-launch-verification.md | generic "provider-marks checks" descriptor | FIXED | 10fc91fc |
| 3 | 2 | BLOCKER | docs/fresh-install-launch-verification.md | served board 403s a bare curl -> false regression | FIXED | 742760e8 |
| 4 | 2 | WARNING | docs/fresh-install-launch-verification.md | origin header framed as sufficient | FIXED | 742760e8 |
| 5 | 3 | NIT | docs/fresh-install-launch-verification.md | inverted gate-ordering prose | FIXED | f7177bbf |

### Strengths (across iterations)
- All 17 browser-checks named by filename exist and are correctly spelled.
- The served-API auth guidance (token at `<store>/board.token`, header
  `x-kosmos-board-token`, off-argv `-H @file`, address from `kosmos status`,
  per-account port) matches install/kosmos + boardauth + server.js exactly.
- The #2279 never-seeded precondition and the BEFORE:0/AFTER:1 recipe match
  engine/projects.js `seedWelcomeHome`/`markWelcomeSeeded` and server.js.
- Every false-PASS/FAIL trap a runbook could introduce (bare-curl 403, mutating a
  real store, box contention, render-vs-server split, deep-link no-mutation) is
  called out with an explicit warning.
- No em dashes in the doc or plan.
