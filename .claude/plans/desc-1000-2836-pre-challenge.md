---
pre_challenge: true
method: challenge-loop
branch: desc-1000-2836
diff_hash: 197e9ab75b38c822f07929862a51c319c1d1fd09d556558d38c9669690db5e60
validation: passed
subdir_audit: passed
timestamp: 2026-09-11T22:57:47Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 blind reviewer pass (opus). **Converged:** no BLOCKER; one WARNING
and two NITs (all comment/test-hygiene) found and fixed.

Card #2836: expand the project description cap from 200 to 1000 characters (Josh:
"to be usable"). Bumped the three coupled sites -- engine Array.from code-point cap,
PJ_DESC_MAX, both rendered "Up to N characters." hints -- and the tests that pin them
together, keeping the deliberate code-point (not UTF-16) counting.

### Iteration 1 (opus)

Confirmed complete and correct: all three runtime sites now say 1000 and agree (the
anti-drift test extracts each dynamically and asserts equality -- it passing is real
evidence, not a hardcoded 1000); no other description-length cap exists; no maxlength
introduced; the refusal-triggering test fixtures were correctly bumped past 1000
(repeat(1001)) while the at-cap "legal" cases use exactly 1000; the emoji boundary
uses 600 code points / 1200 UTF-16 units.

Fixed (no BLOCKER):
- [WARNING] engine/projects.js:1170 -- the code-point rationale comment said an
  all-emoji description is "up to 400 UTF-16 units"; 400 was the old-cap figure, and
  at 1000 code points it is 2000. Scaled the derived figure. FIXED.
- [NIT] web/index.html divergence example (101-emoji) no longer diverged at cap 1000
  (101 emoji = 202 UTF-16 units, under 1000); changed to 501 emoji (1002 units vs 501
  code points), which actually illustrates the code-point-vs-UTF-16 split. FIXED.
- [NIT] server.projects.test.js:1911 -- my blanket repeat(201)->repeat(1001) sweep had
  also changed an UNRELATED task-SENTENCE boundary test (that cap is still 200); the
  test still passed but was no longer a cap+1 boundary. Reverted to repeat(201). FIXED.

## Validation

- 1284 web tests pass; the full description suite (engine/projects, server.projects,
  web.desc-error-1303g pinning + boundaries, project-settings-hints) green; 299 tests
  green on the re-run after the hygiene fixes.
- Browser-check gates #1720 (via a trailer -- the rendered hint and cap behaviour are
  covered by the extraction pinning test and the JS boundary test) and #2518 pass.
- subdir CLAUDE.md audit: passed.

## Weakest premise

That 1000 code points is the intended cap (Josh said "1000 characters"; the engine
counts code points, consistent with the existing deliberate design). Descriptions are
small free text with no separate storage-column limit.

## Outstanding questions

None.
