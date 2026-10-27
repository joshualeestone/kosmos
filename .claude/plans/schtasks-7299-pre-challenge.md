---
pre_challenge: true
method: challenge-loop
branch: schtasks-7299
diff_hash: ce10535c4ae1c4c12ca866aaf187d75dd27299d5f1673c0059bfeb1753b73cda
validation: passed
subdir_audit: passed
timestamp: 2026-10-27T06:37:56Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (round 1 measured against main's matcher, round 2 a fresh blind reviewer who ran about 50 command
lines through both versions). **Converged:** Yes (round 2 found nothing this change lets through; its one in-scope
gap, already on main, is fixed here with a test; one rarer gap is noted on the card).

#7299, the #7270 review's leftovers in tools/lib/schtasks-call.cjs. Validation on 68007d78f2 (rebased on main):
tools.windows-tests-schtasks-7247.test.js 33/33 (the only test that loads the matcher). Each asserted behaviour change
gives the opposite answer on main's matcher (measured).

### Per-Iteration Breakdown

#### Iteration 1 (measured against main)
- The card's [WARNING] command >nul -v schtasks (a lookup) refused --> FIXED. Its [NIT 1] nice >-n 5 schtasks refused
  --> FIXED. Found while testing: timeout >-k 5 schtasks was LET THROUGH on main (the redirect's file read as -k, so
  "schtasks" became the duration) --> FIXED, asserted.
- [NIT 2] valueAt and an argv ">x" --> DOCUMENTED in its comment (PowerShell rejects that value). [NIT 3] valued switches
  keyed to each keyword --> FIXED. [NIT 4] env -- ends the options --> FIXED (no form a real shell runs changes answer,
  so stated in code, not asserted).

#### Iteration 2 (blind review)
- No form this change lets through that main caught (four answers changed, all to the right one).
- [WARNING, already on main] a combined short switch ending in a valued letter let schtasks through (exec -la N,
  time -vo F, timeout -vk 5, nice -vn 5) --> FIXED, asserted with controls.
- [WARNING, already on main, low] env -S -- schtasks (GNU env re-splits -S, then -- ends options) --> NOTED on #7299,
  not built (a different path, the -S string reader).
