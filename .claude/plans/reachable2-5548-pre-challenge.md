---
pre_challenge: true
method: challenge-loop
branch: reachable2-5548
diff_hash: 0fd6b3032a2d9afdfcc7000d93396da82cf3852a5cff6f3127c34447e8a69521
validation: passed (validation_log PASSED for stack=typescript hash=4ec1bd72df15 on main after #5577, full tools/run-tests.sh; engine.reachable.test.js 7/7)
subdir_audit: passed
timestamp: 2026-10-08T19:23:18Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 blind reviews (sonnet, opus, sonnet). The full rounds are in .claude/plans/reachable2-5548.md. Between them the reviewers spot-checked every one of the triaged entries.

**Review 1 (sonnet): 2 WARNING + 1 NIT, fixed**
- [WARNING] three exports were excused as "used inside its own module", which was false: fixed, recategorised as #5346's test seams with accurate reasons.
- [WARNING] bin/ callers were matched on raw text, so a shell script's comment could hide an orphan: fixed. bin/ JS goes through codeOnly and shell scripts lose full-line comments; tested; mutation red.
- [NIT] labelFor cites "OPEN #4375": checked, #4375 is open.

**Review 2 (opus): 1 WARNING + 2 NIT, fixed**
- [WARNING] minInterval was excused as superseded, which was false in the dangerous direction: it is an unwired cost defence (#1645). Fixed: carded as #5583 (wire or delete) and removed from #5582, whose title and body are corrected.
- [NIT] the plan's test count, corrected. [NIT] a future non-JS, non-shell file in bin/ would be stripped as shell: recorded, no current case.

**Review 3 (sonnet): CONVERGED.** It spot-checked the 17 entries the first two rounds had not and found none hiding an unreachable capability. One wording NIT fixed.

**Mutations proven red:** bin/ removed from CALLER_FILES; one triaged entry removed; a fake entry for a called name (shrink-only).

**After convergence:** rebased onto main after #5577 merged. The test passes 7/7 on current main, and the full validation passed on the rebased diff.

**Weakest premise:** the per-name category in the research pass. An entry is cheap to correct, and the shrink-only check stops the list growing.

## After the PR opened: main went red on this guard (12:44 CDT)
#5556 (12:03) added engine/usageprice.js's costOf with no caller by design (#5532's rollup sender is its first);
its CI ran before #5577 put the guard on main, so main's engine.reachable.test.js has failed since. Rebased onto main
and excused costOf in TRIAGED_5548 with that reason: 7/7 with the entry, and red on main without it (the failure that
surfaced it). The full validation in the frontmatter ran on the earlier diff; CI's full run on this head validates this one.

## Rebased again (14:25 CDT): main had grown the guard's lists
Four PRs edited engine.reachable.test.js after this branch was cut: EXCUSED entries (restorerequest, restoresink,
worldUsageByModel), SEAMS entries (computerprint's _test*), and an armed FIRST_CALLER_5532 list with its own test that
still named PENDING_5548. Resolved by keeping all of theirs: `skipped` now ORs TRIAGED_5548 and FIRST_CALLER_5532, and
the printFor test's `without` uses TRIAGED_5548. Both tests added at one spot are kept. Guard 8/8 (7 + printFor).

