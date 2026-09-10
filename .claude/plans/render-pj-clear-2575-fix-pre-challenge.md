---
pre_challenge: true
method: challenge-loop
branch: render-pj-clear-2575-fix
diff_hash: 80b5ac56240f42162d76cf644c976d70ceff46c41d2c3bb53ced54a31dec3f3a
validation: passed
subdir_audit: passed
timestamp: 2026-09-10T20:35:00Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 (converged)
**Converged:** Yes
**Total findings:** 1 (0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT)
**Fixed:** 1 | **Deferred:** 0 | **Asked:** 0

Change under review: a fix to the committed headless browser-check
`docs/browser-checks/render-pj-clear-2575.js` that was ~50% flaky and aborting the
0.6.55 release cut at step 3b. Diagnosis (verified by hooking `paintThread` and
reading `web/index.html`): the product paints correctly every time; the check's
stub let `/api/projects` fall through to a catch-all with no `projects` array, so
the page's one-time startup `loadProjects()` (`PROJECTS = body.projects || []`)
resolved late and wiped the seeded project, resetting the view and re-hiding the
just-painted question. Fix: the stub answers the projects list GET with the seeded
project (shared `window.__project`), so no late poll can clobber the seed. This is
a harness-completeness fix; the product is unchanged and correct.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (fresh, blind)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0
- [NIT] docs/browser-checks/render-pj-clear-2575.js — the `/api/projects` branch
  also matched the create POST (same bare path), unexercised today --> FIXED:
  scoped the branch to GET so a create POST still hits the catch-all.

**Converged** -- no BLOCKER/WARNING/CONVENTION findings; the one NIT was applied.

### Verification (measured on the shipping HEAD)
- The committed check: 15/15 idle runs PASS before the NIT fix, 4/4 PASS after it
  (19/19 total on HEAD). It was 3 fail / 6 runs before the fix.
- Full validation-log sequence PASSED (type-check, node test suite, browser-check
  gate + surface map 0 FAILED, build). The only change since that run is the NIT
  GET-guard in the browser-check script, which validation-log does not execute.
- `node --check` clean; subdir CLAUDE.md audit not applicable (no subdir CLAUDE.md
  touched).

### Final Ledger
| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | NIT | render-pj-clear-2575.js | SELF | /api/projects branch matched create POST | FIXED | GET-scoped |

### Strengths (across the run)
- Race removed at its source (every read of projects agrees) rather than by
  widening a timeout; the shared `window.__project` reference makes seed and stub
  response structurally unable to drift.
- Diagnosis independently confirmed in the product (`PROJECTS = body.projects || []`
  clobber and the `if (!p) pjView('list')` reset), so the harness-vs-product call
  is evidence-based, not asserted.
- The projects-list regex correctly discriminates the plural list from the singular
  `/api/project/<id>/...` routes; the failed-clear and persistence scenarios are
  untouched, so coverage is not weakened.
