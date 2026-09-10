---
pre_challenge: true
method: challenge-loop
branch: inline-errors-2606
diff_hash: 4b71805f2c6f6a7440ac7556c43e95ba5d53918212ff6d127e4d01ad18506361
validation: passed
subdir_audit: passed
timestamp: 2026-09-10T01:28:39Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5 (iteration 1 was the 6.0 fix-and-validate pass; iterations 2-5 were fresh blind reviewers)
**Converged:** Yes (iteration 5 found zero BLOCKER/WARNING/CONVENTION)
**Total findings:** 13 (3 BLOCKERs, 4 WARNINGs, 2 CONVENTIONs, 4 NITs)
**Fixed:** 12 | **Deferred:** 1 (a scoped NIT) | **Asked:** 0

Card kosmos#2606: Create an Agent and Create a Project show validation errors INLINE and
field-level (red border + message beside the field + focus, via the shared pjFieldBad helper),
not as small text below the submit button (Josh's product review; same structural defect as
#1303 G, one form along).

### Per-Iteration Breakdown

#### Iteration 1 (the 6.0 fix-and-validate pass)
**Reviewer model:** n/a (validation-gate pass, no blind reviewer yet)
**New findings:** 2 BLOCKERs, 1 CONVENTION
**Self-generated:** 0 (all raised by the validation gates against the freshly-added browser-check)
- [BLOCKER] validation -- #1720 browser-check gate: a web/ change carried no docs/browser-checks assertion --> FIXED (152408c6): added render-inline-field-errors-2606.js (a real Playwright assertion, 24/24), registered in tools/browser-checks.sh + docs/browser-checks/README.md
- [BLOCKER] browser-checks-reason-grep.test.js -- the new check adds one FAIL-emit loop; EXPECTED_SITES must go 77->78 --> FIXED (73818823)
- [CONVENTION] validation -- #2518 surface gate: a comment mentioning #create-msg maps to render-createnav-2190 --> FIXED (32e65bd8): ran that check (green), added the per-check Browser-check-surface trailer

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 1 WARNING
**Self-generated:** 0
- [WARNING] web/index.html -- the /name/i catch comment claimed it routed a "folder collision" to the field, but that message ("that folder is already the project X") contains no "name" and falls through --> FIXED (92652aa0): corrected the comment

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 WARNING, 1 CONVENTION, 1 NIT
**Self-generated:** 1 (the NIT was on the comment iteration 2 had just rewritten)
- [WARNING] engine/create.js -- only the nameProblem char/length refusal carried field:'name'; the name-COLLISION refusals (removed list, already-an-agent, folder/job left behind, already running) still landed below the button --> FIXED (32e65bd8): tagged them, guarded by a new test
- [CONVENTION] .claude/plans/inline-errors-2606.md -- em dashes (Josh's standing style rule) --> FIXED (32e65bd8): replaced with hyphens
- [NIT] web/index.html -- the /name/i comment (rewritten in iter 2) was still imprecise (omitted the 1505 file-with-that-name case) --> FIXED (32e65bd8): per kosmos#120, DELETED the fragile enumeration rather than write a third careful version; the regex is the source of truth

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 2 WARNINGs, 1 NIT
**Self-generated:** 1 (the could-not-check WARNING was on a line iteration 3 had just tagged)
- [BLOCKER] engine/create.js -- a 7th name-collision refusal (the launchd-service "loaded" check, "already set to start ... nothing else left of it") was left untagged, and the coverage test's fragment list omitted it (false completeness) --> FIXED (f171d96c): tagged + added to the test
- [WARNING] engine/create.js -- tagging the fail-closed "we could not check which agents are running" refusal field:'name' flags the name field red for a SYSTEM failure, not a known-bad name --> FIXED (f171d96c): UNtagged it; the test now asserts it stays untagged (negative control)
- [WARNING] web/index.html -- the project /name/i matched the raw server message, which can interpolate an existing project's TITLE ("...the project X"); a title containing "name" (e.g. "Renamed Docs") false-routed a folder collision to the name field --> FIXED (f171d96c): narrowed to the specific name-rule phrases projects.js throws; a coupling test pins the regex to those messages and proves a folder collision does not match
- [NIT] .claude/plans/inline-errors-2606.md -- plan omitted the launchd-loaded collision --> FIXED (f171d96c)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 (the stale-comment NIT was on a comment this loop wrote)
**Converged** -- no new actionable findings. Both opus and sonnet witnessed the convergence.
- [NIT] web.desc-error-1303g.test.js -- a stale comment said "pj-create has TWO" while the assertion (updated this PR) expects 4; the paired comment was updated but this one was missed --> FIXED (final commit): now says FOUR
- [NIT] engine/create.js -- the engine role-label refusals stay below-button even though a create-label-err slot exists --> DEFERRED: scoped out per the plan (the client empty-role gate + maxlength intercept the common cases; only exotic non-word label content reaches the engine path, and field:'label' routing was never in scope). Recorded for the author to revisit if symmetry is wanted.

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | validation | BRANCH | #1720: web/ change, no browser-check | FIXED | 152408c6 |
| 2 | 1 | BLOCKER | browser-checks-reason-grep.test.js | BRANCH | emit-site count 77->78 | FIXED | 73818823 |
| 3 | 1 | CONVENTION | validation | BRANCH | #2518 surface gate (create-msg) | FIXED | 32e65bd8 (trailer) |
| 4 | 2 | WARNING | web/index.html | BRANCH | /name/i comment overstated folder-collision routing | FIXED | 92652aa0 |
| 5 | 3 | WARNING | engine/create.js | BRANCH | name-collision refusals untagged | FIXED | 32e65bd8 |
| 6 | 3 | CONVENTION | .claude/plans/inline-errors-2606.md | BRANCH | em dashes | FIXED | 32e65bd8 |
| 7 | 3 | NIT | web/index.html | SELF | /name/i comment still imprecise | FIXED | 32e65bd8 (deleted enumeration) |
| 8 | 4 | BLOCKER | engine/create.js | BRANCH | launchd-loaded collision untagged | FIXED | f171d96c |
| 9 | 4 | WARNING | engine/create.js | SELF | could-not-check (system failure) mis-tagged | FIXED | f171d96c (untagged) |
| 10 | 4 | WARNING | web/index.html | BRANCH | project /name/i false-matches interpolated title | FIXED | f171d96c (narrowed + coupling test) |
| 11 | 4 | NIT | .claude/plans/inline-errors-2606.md | BRANCH | plan omitted launchd check | FIXED | f171d96c |
| 12 | 5 | NIT | web.desc-error-1303g.test.js | SELF | stale pointer-count comment | FIXED | final commit |
| 13 | 5 | NIT | engine/create.js | BRANCH | role-label engine refusals untagged | DEFERRED | scoped out per plan |

### NITs (non-blocking)
- [NIT] engine/create.js -- role-label engine refusals (2795/2799) stay below-button; DEFERRED as scoped (client gate + maxlength cover the common cases; field:'label' routing not in scope). The author may add it later for symmetry.

### Strengths (across iterations)
- The field:'name' tag keeps the refusal SENTENCE server-owned (no client-side copy of the name rule), honoring the form's stated design; it says only where the message goes.
- Every name-collision refusal is tagged and the fail-closed system-check refusal is deliberately left untagged, both pinned by a test with an explicit negative control.
- The project name-rule routing uses the specific thrown phrases (not a broad /name/i), ordered after /description/i, guarded by a coupling test that pins the regex to projects.js and proves an interpolated folder-collision title does not false-route.
- The browser check reads getComputedStyle().borderColor and asserts it CHANGED from the plain border (so the broadened .frow input.bad selector is proven to paint, not merely present), proves pjFieldOk clears the flag, and drives the real #pj-create click handler for the empty-name path.
