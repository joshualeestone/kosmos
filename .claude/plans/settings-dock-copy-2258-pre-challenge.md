---
pre_challenge: true
method: challenge-loop
branch: settings-dock-copy-2258
diff_hash: 9f45ad58da2a0923abfade8592d0d5c8d8e4d196e5649b0e8750f013f9a0e7e5
validation: passed
subdir_audit: passed
timestamp: 2026-09-05T19:23:18Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 1 WARNING, 7 STRENGTHs
**Fixed:** 1 WARNING | **Deferred:** 0 | **Asked:** 0

Validation: `tools/run-tests.sh` ran to completion with exit 0. run-tests.sh short-circuits (each step
runs only `if [ "$NODE_STATUS" -eq 0 ]`), so reaching its final step, the #1720 browser-check gate, proves
`node --test` (all web tests) and `yarn test:shell` both passed; the gate then accepted the commit's
`Browser-check:` trailer ("overridden -- copy-only ...") and returned 0. The suite was run in the window
after release 0.6.36 freed the box and before its re-cut; NOT re-run during the browser-quiet window (the
run reaching the gate already evidences exit 0). `web.dock-icon-1212.test.js` also verified standalone 4/4.

### Per-Iteration Breakdown

#### Iteration 1
**New:** 0 BLOCKER, 1 WARNING, 0 CONVENTION, 0 NIT
- [WARNING] web/index.html:9901 — the #1212 HTML comment beside the .dockrow still quoted the removed
  "Drag it onto the Dock" wording and its now-obsolete "folder of hundreds" rationale. (I had refreshed the
  MIRROR comment in the test header but missed this one beside the actual code.) --> FIXED: refreshed it to
  the new wording, keeping the icon-as-referent point and noting the #2258 change.

#### Iteration 2
**New:** 0 BLOCKER, 0 WARNING, 0 CONVENTION, 0 NIT --> CONVERGED (no issues found)

### Final Ledger
| # | Iter | Category | File:Line | Description | Status |
|---|------|----------|-----------|-------------|--------|
| 1 | 1 | WARNING | web/index.html:9901 | stale #1212 comment beside the code | FIXED |

### Outstanding questions (ASKED)
None.

### Strengths
- The defect is fully removed: no live user-facing "onto the Dock" remains; the only residual strings are
  the two refreshed comments intentionally quoting the old phrase to explain what was removed (iter 1, 2).
- Test updated in lockstep (`/Drag it to the far left/`); still guards the full #1212 icon design (img,
  informative alt, 2x sharpness, file-ships, a CONTROL); 4/4 pass against the new copy (iter 1, 2).
- Both mirror comments (test header + the HTML comment beside the code) refreshed together; no stale
  "folder of hundreds" rationale remains (iter 2).
- Wording consistent with #2240's merged Success copy; em-dash-free, short, plain; `Browser-check:` trailer
  present and non-empty, satisfying the #1720 gate for a copy-only web/ change (iter 1, 2).
