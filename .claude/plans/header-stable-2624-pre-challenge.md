---
pre_challenge: true
method: challenge-loop
branch: header-stable-2624
diff_hash: eb8b9bd8da1de0fbedec49cf511fe72476c3c978dcb9f117ff07b20878c51046
validation: passed
subdir_audit: passed
timestamp: 2026-09-26T09:44:01Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes, with one WARNING decided and disclosed (below), no BLOCKER in any round.

Validation: validation_log_run_or_skip clean at fe809723 (full tools/run-tests.sh stack).
Full tools/browser-checks.sh run on the header commit: every check green except
render-dm-emoji-3744 and render-help-tips-3574, both then fixed and re-run green on this
tree and red on origin/main where the fix says they should be. Gates: coarse and surface
clean (surface via two measured Browser-check-surface trailers).

### Iteration 1 (header commit)
No BLOCKER/WARNING/CONVENTION. NITs left: 1px nudge not applied to single-line notice
pills; the check does not pin the tabs' own vertical position (measured by the reviewer: the
change improves tab/K-mark alignment from ~6px off to ~0.6px); no sample at exactly 960px.

### Iteration 2 (the two check corrections)
No BLOCKER. Reviewer reproduced every claim by measurement, including that on origin/main the
Conversation tip sat on both header tab buttons, and that tipPlace has no clean placement at
1280x860 today (filed as #3920). [WARNING] the 30px intrusion cap was arbitrary --> FIXED:
bound restated as 5% of the area's height (an edge sliver).

### Iteration 3
No BLOCKER. [WARNING] 5% is still a chosen number, not a derived constant --> DECIDED, not
changed: any bound here is a policy line between "edge sliver" and "covers content"; the real
fix, which removes the need for one, is #3920. [NIT] String(className) on an SVG label, inert.

### After two rebases onto main (browser-checks.sh loop-line conflicts only)
Validation clean at eb8b9bd8. Gates clean; render-tophead-stable-2624, render-tophead-consolidated-2282, render-dm-emoji-3744 and render-help-tips-3574 re-run green on the rebased tree. A full tools/browser-checks.sh run on the first rebase was green except render-accounts-openai, which fails identically on main: bisected to c00ccac97 (#3910), reported on #3874, and Angel is fixing it.
