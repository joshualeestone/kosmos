---
pre_challenge: true
method: challenge-loop
branch: route-gate-3957
diff_hash: 035cdbfc9189c71273db1c1e33e0022393b3e8a108c86d4ff8ca44380fef0ee7
validation: passed
subdir_audit: passed
timestamp: 2026-09-26T19:17:49Z
iterations: 14
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 14
**Converged:** Yes (iteration 14, sonnet: nothing actionable)
**Fixed:** every BLOCKER and WARNING raised; per-iteration fixes are recorded in the plan
(.claude/plans/route-gate-3957.md), one section per iteration.
**Deferred:** the documented KNOWN LIMITS (free-segment board routes, placeholder segments served by
an enumerated sibling, helper calls with a variable URL, markup in JS strings outside quoted
src/srcset/href/action), each stated in the header and CLAUDE.md convention 7, and the two that can
be pinned are pinned by tests.
**Asked (awaiting user):** 0

⚠️ Honest scope of this ledger: iterations 1 to 12 ran across a context compaction. Their findings
and fixes survive in the plan and in the per-iteration commit messages, but not as a per-severity
tally, so no invented counts are given for them here.

Reviewer models alternated opus/sonnet by iteration.

Validation: the first full run (validation_log_run_or_skip) PASSED at 731e22f54 (hash 035cdbfc9189),
after iteration 14; subdir CLAUDE.md audit rc 0.

History proof, repeated after every change: against 07a786f9a (the page and board that shipped the
0.6.96 bug) the gate reds naming exactly /api/federation/invite, /join and /verify.

### Per-Iteration Breakdown

#### Iterations 1 to 12
See the plan, sections "Challenge-loop iteration N". BLOCKERs among them, all fixed:
- [BLOCKER] iteration 2: the comment scanner ended every string at a line break --> FIXED
- [BLOCKER] iteration 2: a comparison quoted inside a board log string counted as a route --> FIXED
- [BLOCKER] iteration 4: a line-leading / was always a regex, hiding calls --> FIXED
- [BLOCKER] iteration 6: a template URL with an interpolated base was not read --> FIXED
- [WARNING] iteration 11: two lexer controls planted after </html> guarded nothing --> FIXED
- [WARNING] iteration 12: '/api' + '/x' split URL unread --> FIXED (bf0754f77)

#### Iteration 13
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
- [WARNING] web.api-routes-3957.test.js:225 - a template fetch with a variable base neither read nor counted --> FIXED (2370e24c7)
- [WARNING] web.api-routes-3957.test.js:577 - stray-backtick control could not fail with line-bound removed --> FIXED (2370e24c7; plan over-claim corrected in 731e22f54)
- [WARNING] web.api-routes-3957.test.js:375 - wildcard pin caught only .* / .+ --> FIXED (two-free-segment probe)
- [NIT] four lexer rules had no control that reds --> FIXED (7 of 7 mutations red by name)
- [NIT] regexCanStart comment contradicted the code --> FIXED
- [NIT] poster=, unquoted attributes, CSS url() unread and uncounted --> DOCUMENTED in the header
- [NIT] a nested template inside a template URL gives a junk path --> DEFERRED: fails loud (a false red, never a false green)

#### Iteration 14
**Reviewer model:** sonnet
**New findings:** 0. Independently reproduced the history proof and the measured counts
(185 paths, 19 unread, 1 unreadable). Converged.
