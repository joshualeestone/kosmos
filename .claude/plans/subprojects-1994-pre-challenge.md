---
pre_challenge: true
method: challenge-loop
branch: subprojects-1994
diff_hash: 50e811dc64979f016e4d2d7c63f458c03a27363e5540591bf215bf647aba5bf6
validation: passed
subdir_audit: passed
timestamp: 2026-09-04T15:50:02Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7 (a clean 6.0 baseline + 6 fresh blind review passes)
**Converged:** Yes — the sixth blind pass produced zero new actionable findings.
**Total findings:** 4 BLOCKER/WARNING + 3 CONVENTION/count + several NITs; every actionable one fixed.
**Fixed:** all actionable | **Deferred:** 2 (documented below) | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1 — 6.0 baseline
`web.desc-error-1303g.test.js` counted refusal-pointer sites; the new parent
refusal branch legitimately added one, so the count assertion failed. Updated
the counts (pjs-save 2->3, total 4->5) to reflect the new, correct path
(commit fbe2f750). This is a test contract-sync, not a product change.

#### Iteration 2 — blind pass 1 (commit c2bfc016)
- [WARNING] archived-parent SILENT UN-GROUP: a current parent that is archived
  (engine allows archiving a project with children) had no `<option>`, so the
  select fell back to "Top level (none)" and a later save of an UNRELATED field
  sent `parent:null`, un-grouping a project nobody touched. --> FIXED: prepend a
  preselected option representing the current parent so the changed-fields diff
  stays honest; added an archived-parent browser-check case.

#### Iteration 3 — blind pass 2 (commit 019cfb07)
- [WARNING] the parent-refusal regex missed the engine's exact "gone" message
  ("there is no project to group this one under"), so a parent deleted between
  paint and save (TOCTOU) fell through to the generic line. --> FIXED.
- [NIT] no `pjFieldOk` reset for the parent field at save start. --> FIXED.
- [CONVENTION] em dashes in the check header + README row. --> FIXED (removed).

#### Iteration 4 — blind pass 3 (commit 1804ad88)
- [NIT] in list view the orphan (archived/dangling parent) had its chip hidden
  by the indent rule despite having no indent, so it read as top-level. --> FIXED:
  hide the chip only on indented `.child` rows; added list-mode chip coverage.

#### Iteration 5 — blind pass 4 (commit 44af66ec)
- [WARNING] `pjPaintParentSelect` cleared only the error text, not the `.bad`
  class / aria-invalid, so reopening settings after a parent refusal (without
  saving) showed a red, invalid select with no reason. Iter 2's reset covered
  save-start, not panel-open. --> FIXED: call `pjFieldOk` in the paint; added a
  reopen-clears-state case with a positive control.

#### Iteration 6 — blind pass 5 (commit 7bf5510f)
- [WARNING] the browser check verified the indent via the inline `--pj-depth`
  var it set, not the COMPUTED margin-left (a CSS-calc typo would ship green),
  and only exercised list mode. --> FIXED: assert computed margin-left
  (22/44/0px) + a grid-mode block (indent drops, chip becomes visible).
- [CONVENTION] a save-handler comment's rationale was stale after iter 4. --> FIXED.

#### Iteration 7 — blind pass 6 (commit ef58ab9e)
**New actionable findings: 0.** Converged.
- [NIT] plan said "40 assertions"; shipped 64. --> FIXED (plan count corrected).
- [NIT] regex carries harmless defensive tokens (`cycle|circular|itself`) that
  match none of the engine's four messages; routing verified correct. --> DEFERRED
  (defensive, harmless).

### Deferred (deliberate)
- The parent-refusal regex's defensive tokens (harmless redundancy; the reviewer
  verified all four engine `cleanParent` messages route correctly).
- A cosmetic sub-project count on a node inside a STORED cycle (unreachable — the
  engine refuses cycles; the render backstop still shows every row).

### Strengths (across passes)
- Nothing-vanishes is structural: children of archived/dangling parents re-home
  to top level; a `seen` guard + top-level backstop render a stored cycle without
  hanging or dropping rows (control-tested).
- The archived-parent preselect closes a subtle silent-mutation hole and is the
  load-bearing pair with the changed-fields-only save.
- XSS clean on every new sink (esc on parentName/id/name/label; numeric coercion
  on depth/count); no regression to the flat list (byte-identical output).
- The browser check drives the shipped functions with controls that can return
  the dangerous answer, verifies computed CSS (not just the inline var), and is
  registered in the runner + README.
