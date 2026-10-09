---
pre_challenge: true
method: challenge-loop
branch: redonce-5589
diff_hash: 58f2cc1e2393825f205f6938301b98ccf7204c58d9e6f925cf34d5309ca0a5e9
validation: passed (Mortals, entry clean, 16919 tests, 0 fail, 0 cancelled)
subdir_audit: passed
timestamp: 2026-10-08T19:09:14Z
iterations: 22
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 22
**Converged:** Yes. Iteration 21 (opus) returned NITs only; four were taken (a damaged deploy.pid is never signalled, perl's exec never goes through a shell, one-line STILL FAILING, a per-sha key test red-checked against a mutant), so iteration 22 (sonnet) was run on the result: no BLOCKER or WARNING (its CONVENTION line confirmed the plan file exists and matches the code), NITs only.
**Total findings:** every round 1 to 20 found at least one actionable issue. Each round's commit ("address challenge-loop iteration N"; round 8's is "escape the ::warning:: annotation") lists its fixes; this proof quotes the first item of each and does not invent category counts. Each round's main item is listed as [WARNING] (my reading: each was WARNING or higher).
**Fixed:** all actionable findings in rounds 1 to 20, and four NITs from 21 | **Deferred:** test 13 running last (renumbering churn); publisher_running before the already-live shortcut (fail-closed on purpose); round 22's NITs (test header naming every ps-reading test; the mirror arm under root; paused after the fetch) | **Asked:** 0
**Red-checks:** every test added from round 11 on was run against a copy with its fix removed and went red, except where the plan says it cannot be produced on demand (the launch window; a ps listing past a pipe buffer). Three tests were found vacuous by that check and rewritten (test 26's leftover count, test 33's too-new build, test 23b's per-sha key).
**Validation:** see the front matter; the full suite on Mortals for this exact diff hash.
**Reviewer models:** opus on odd iterations, sonnet on even.

### Per-Iteration Breakdown
#### Iteration 1
**Reviewer model:** opus
- [WARNING] tools/site-autodeploy.sh - one record per sha and cause (reported.d/<sha>-<cause>), so two causes taking turns never re-arm each other (tested: alternating checksum/moving on one sha reds 1100) --> FIXED (commit 1909263ca; its message lists the round's other fixes)

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] tools/site-autodeploy.sh - the deploy's stdin is /dev/null (a background job under set -m would stop on a read) --> FIXED (commit c102fa346; its message lists the round's other fixes)

#### Iteration 3
**Reviewer model:** opus
- [WARNING] tools/site-autodeploy.sh - the deploy's output is printed whole when it ends (no live tail -f): a killed tick left the tail orphaned (four were found on Agent1s from test runs and stopped by verified pid), and a fixed sleep could cut off the last lines --> FIXED (commit 715ff3a43; its message lists the round's other fixes)

#### Iteration 4
**Reviewer model:** sonnet
- [WARNING] tools/site-autodeploy.sh - which records clear on recovery is now stated exactly: wedged/fetch/noref when they recover; the retry-type causes only on a successful deploy, because until then the sha has not shipped (a second incident the same day is the same open problem). Clearing those on any passing check was tried and rejected: it re-armed alternating causes every tick (test 20 went 1110). --> FIXED (commit e6c058af5; its message lists the round's other fixes)

#### Iteration 5
**Reviewer model:** opus
- [WARNING] tools/site-autodeploy.sh - a tick killed mid-deploy keeps the deploy's output (run + log) and escalates TERM to KILL on the deploy group, like the timeout path (stop_deploy, shared); test 23 checks the output is logged and now signals only after the tick says it is deploying (no race with its traps) --> FIXED (commit 5ad62d551; its message lists the round's other fixes)

#### Iteration 6
**Reviewer model:** sonnet
- [WARNING] tools/site-autodeploy.sh - the STILL FAILING line names the record file to remove to make it red again now, and a suppressed repeat also prints a ::warning:: annotation, so the green run is visibly not healthy in the run list --> FIXED (commit b343c0ae3; its message lists the round's other fixes)

#### Iteration 7
**Reviewer model:** opus
- [WARNING] tools/site-autodeploy.sh - a timed-out deploy is a FAILURE (exit 124), not a retry (75 means nothing was published, and a deploy can be stopped after vercel deploy, during its served checks): retried once, then parked, and the already-live shortcut cannot bless the sha while the failure count stands (tested: a second hang with a marker naming the sha parks it, last-deployed unchanged) --> FIXED (commit 45ea8bd85; its message lists the round's other fixes)

#### Iteration 8
**Reviewer model:** sonnet
- [WARNING] tools/site-autodeploy.sh - Iteration 8 found no new actionable issue (its warning restates the documented red-once trade-off, rounds 4 and 6). Two nits taken: the annotation escapes % and CR/LF, so a message cannot break it or inject a second workflow command; the header says records for a superseded sha linger until the next --> FIXED (commit 710054b54; its message lists the round's other fixes)

#### Iteration 9
**Reviewer model:** opus
- [WARNING] tools/site-autodeploy.sh - a tick killed mid-deploy records a FAILURE (rc 143): the deploy may have published, so the next tick's already-live shortcut must not bless the sha, same as a timeout (tested: red without it) --> FIXED (commit 74a51d3b1; its message lists the round's other fixes)

#### Iteration 10
**Reviewer model:** sonnet
- [WARNING] tools/site-autodeploy.sh - the deploy cap is 1200 s and the comment says it bounds the deploy phase only (20 minutes leaves room in the 30-minute job for the fetch, mirror and checks) --> FIXED (commit 901df5a41; its message lists the round's other fixes)

#### Iteration 11
**Reviewer model:** opus
- [WARNING] tools/site-autodeploy.sh - killed_tick ignores further signals first and records the failure BEFORE the slow stop, so a runner's escalating cancel (a second TERM) cannot cut the record out (test 27). --> FIXED (commit 0589410f8; its message lists the round's other fixes)

#### Iteration 12
**Reviewer model:** sonnet
- [WARNING] tools/site-autodeploy.sh - The deploy launch cannot be cut between the fork and dpid: signals are noted (trapped, not ignored) until deploy.pid is written, then acted on. --> FIXED (commit fe9f6f6f9; its message lists the round's other fixes)

#### Iteration 13
**Reviewer model:** opus
- [WARNING] tools/site-autodeploy.sh - killed_tick stays the EXIT trap from the deploy's launch until its result is written (an accounted flag in each branch), so a kill after the deploy ended but before its result was recorded still records rc 143; the deploy output is printed exactly once. --> FIXED (commit af5c77c53; its message lists the round's other fixes)

#### Iteration 14
**Reviewer model:** sonnet
- [WARNING] tools/site-autodeploy.sh - A build above the release-pointer ceiling that is already in this dist/ and still in the source is removed before the deploy: the rsync exclude also shielded it from --delete (test 33, red-checked; its first version planted a file rsync deletes anyway and passed with the fix removed). --> FIXED (commit 4d299c56f; its message lists the round's other fixes)

#### Iteration 15
**Reviewer model:** opus
- [WARNING] tools/site-autodeploy.sh - A report time, failure count or mirror count with a leading zero (089: invalid octal) aborted the tick under bash arithmetic, so a damaged record turned into a red every tick; now it reads as 0 like any damaged value (test beside test 19's, red-checked against the old guard). --> FIXED (commit fbe94d2d5; its message lists the round's other fixes)

#### Iteration 16
**Reviewer model:** sonnet
- [WARNING] tools/site-autodeploy.sh - The header and the plan said the fetch cap was 600; the code has said 300 since iteration 15. --> FIXED (commit f126fd57c; its message lists the round's other fixes)

#### Iteration 17
**Reviewer model:** opus
- [WARNING] tools/site-autodeploy.sh - A good fetch no longer clears the fetch record: a network that fails on some ticks and works on others re-armed its own red after every good tick (up to 48 emails a day for one problem). The record lasts its day or until a deploy succeeds. Test 21 asserts the flap stays reported and a day-old record is red again (red-checked: the old clear gives 10011). --> FIXED (commit b37c7c977; its message lists the round's other fixes)

#### Iteration 18
**Reviewer model:** sonnet
- [WARNING] tools/site-autodeploy.sh - publisher_running fails CLOSED: an unreadable or empty process list cannot rule out a cut, so nothing deploys and it is red once a day (red_once psread); before, it read as nothing running (test 35, red-checked: the old code deployed twice). --> FIXED (commit b581d15d5; its message lists the round's other fixes)

#### Iteration 19
**Reviewer model:** opus
- [WARNING] tools/site-autodeploy.sh - The header and plan said the process-list record was keyed none; it is per sha (made after the sha is known), so a new push while ps stays unreadable is red once more. Wording fixed, not the code. --> FIXED (commit e2af4ae93; its message lists the round's other fixes)

#### Iteration 20
**Reviewer model:** sonnet
- [WARNING] tools/site-autodeploy.sh - The plan file is named <branch>-<date>.md, as the convention asks. --> FIXED (commit 54f3102ce; its message lists the round's other fixes)

#### Iteration 21
**Reviewer model:** opus
- [NIT] tools/site-autodeploy.sh - a damaged deploy.pid pgid (0) would reach kill -- -0 --> FIXED (f3102817e)
- [NIT] tools/site-autodeploy.sh - perl exec @ARGV with one element goes through a shell --> FIXED (f3102817e)
- [NIT] tools/test-site-autodeploy-5589.sh - no test that records are per sha --> FIXED (f3102817e, red-checked)
- No BLOCKER, WARNING or CONVENTION.

#### Iteration 22
**Reviewer model:** sonnet
- [NIT] tools/test-site-autodeploy-5589.sh:5 - the header does not list every test that reads the real process table --> DEFERRED (wording)
- [NIT] tools/test-site-autodeploy-5589.sh - test 25's mirror arm assumes a non-root tester --> DEFERRED (the runner is not root)
- [NIT] tools/site-autodeploy.sh - paused is checked after the fetch, so a fetch outage still reports while paused --> DEFERRED (the outage is real)
- No BLOCKER or WARNING; converged.
