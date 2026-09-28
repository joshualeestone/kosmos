---
pre_challenge: true
method: challenge-loop
branch: tmpleak-4273
diff_hash: 4cf1153f40aa7dd4cf0804f8aeeb65fd35d744bb516208b36ff85940f157716d
validation: passed
subdir_audit: passed
timestamp: 2026-09-28T05:43:50Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** Yes
**Total findings:** 18 actionable (3 BLOCKERs, 15 WARNINGs), 11 NITs, counted from the plan's review record
**Fixed:** 18 actionable, 8 NITs | **Deferred:** 3 NITs (round 2: a plural, a launchd label with a space, the kts- source pin kept on purpose) | **Asked (awaiting user):** 0

Evidence: full tools/run-tests.sh run 7 at 3ef83e303 (code identical to this head): 11001 tests, 0 fail, guard GREEN
with no leak lines. Run 5 went RED on a real leak (engine/agyhooks.test.js left kosmos-agy-throttle), fixed by
tmpscope. tools/test-test-leak-guard-4273.sh: 54 checks, each guard perturbed red. test-support.tmpscope.test.js:
10/10 with real child processes. A traced node-suite run found no mkdtemp without a named prefix. Per-round detail,
with every perturbation, is in .claude/plans/tmpleak-4273.md.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [BLOCKER] launchd reports the resolved /private/var plist path, so the check never matched. Fixed: both spellings.
- [BLOCKER] a pid inside a name made a new family every run; its source compared a Promise with 64. Fixed: digit tokens dropped, the test awaits.
- [WARNING] the family rule ate real words / skipped empty names. Fixed.
- [WARNING] an all-one-case random token mid-name. Fixed: allowlist globs.
- [WARNING] the process check could kill an operator's process. Fixed: orphans only.
- [WARNING] tmpscope re-raised over a file's own handler. Fixed: stands aside, tested.
- [WARNING] wiring untested. Fixed: one entry point tested end to end, plus a call-order pin.
- [NIT] notes and comments. Fixed.

#### Iteration 2
**Reviewer model:** sonnet
- [BLOCKER] the no-separator branch stripped the last 6 characters unconditionally, hiding real names. Fixed.
- [WARNING] an all-one-case random tail made a family flaky. Fixed.
- [WARNING] a bare root as its own argument was not matched. Fixed.
- [WARNING] TERM then KILL after 1s. Fixed: 3s.
- [WARNING] browser-check helpers re-raised over another handler. Fixed.
- [NIT] x3 deferred (see summary).

#### Iteration 3
**Reviewer model:** opus
- [WARNING] two stand-aside signal handlers stood aside for each other. Fixed: remove-at-end.js, one handler per process.
- [NIT] interrupted runs skip the guard. Fixed: the EXIT trap runs the launchd check.
- [NIT] separator-less random tails. Documented.

#### Iteration 4
**Reviewer model:** sonnet
- [WARNING] launchctl print format drift reads clean. Fixed: shared parse, note line, real-launchctl canary.
- [NIT] only SIGTERM tested. Fixed: SIGINT and SIGHUP arms.

#### Iteration 5
**Reviewer model:** opus
- [WARNING] a replaced pre-loaded com.kosmos job passed. Fixed: pre-loaded com.kosmos.* labels judged.
- [NIT] orphan judged mid-shutdown. Fixed: one-second grace.

#### Iteration 6
**Reviewer model:** sonnet
- [WARNING] the canary would fail with no GUI domain. Fixed: skips when nothing is printable.
- [WARNING] the socket-path comment understated the depth. Fixed.

#### Iteration 7
**Reviewer model:** opus
- [WARNING] (unnamed) false fail about 1 run in 90. Fixed at the source: a normaliser bug that dropped the sweep2 prefix; the (unnamed) line is removed.
- [NIT] 8-character mktemp tails are not recognised. Documented.

#### Iteration 8
**Reviewer model:** sonnet
- No findings.
