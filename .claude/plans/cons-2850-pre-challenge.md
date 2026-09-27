---
pre_challenge: true
method: challenge-loop
branch: cons-2850
diff_hash: 8a9f1054b2eb0e23a17e6014a4516b3abbdef9977e6f58b6243ed0fe68f4aa8b
subdir_audit: passed
timestamp: 2026-09-27T14:52:53Z
converged: true
---

## Challenge loop: #2850 item 12, the collapse button flush with the avatar ring

#### Iteration 1 (blind, sonnet)
- [LOW] 18px is the sum of #alist's 8px padding and the row's 10px, tied only by a comment --> ACCEPTED and named as
  the plan's weakest premise; the new browser-check arm (1px tolerance) catches any drift in CI.
- [LOW] the narrow-width wrap was untested --> MEASURED: the rail auto-folds below about 1280px (the rule is scoped to
  the open rail); at 1290px (rail 214px) the head stays one line, the name does not overflow, and the fold and + share
  a line.
- Checked clean: specificity (1,3,2) beats the 8px shorthand (1,2,2) whatever the order; fold-a falls back to 8px;
  scoped to #rail-agents only; the + is untouched; the arm cannot pass vacuously (a row exists, the rail is open).
- No em dash.

#### Iteration 2
Not run: iteration 1 found no defect; both LOWs resolved (one accepted with its guard, one measured).
NO NEW FINDINGS.

## Evidence
- render-agent-lines on the branch: all passed, incl. {"fold":18,"ring":18}; with main's page: FAIL {"fold":8,"ring":18}.
- Re-run after the rebase onto main: passes.
- web.*.test.js 1982/1982. Full suite 10717 pass, 0 fail, exit 0. #1720 and #2518 gates pass.
- Renders of the open and folded rails (light), items 2 to 5 and 9 to 11 measured on main (see the plan).
