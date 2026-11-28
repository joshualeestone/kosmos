---
pre_challenge: true
method: challenge-loop
branch: held-8959
diff_hash: 88faecd94efcfbd590f31e2d8643108447320b58e573089ee837d5a769c6c8d4
validation: passed
subdir_audit: passed
timestamp: 2026-11-28T07:01:46Z
iterations: 3
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** No (round 3 found no BLOCKER or MAJOR, but it still fixed four MINORs, so it is not a clean round)
**Total findings:** 0 BLOCKERs, 3 WARNINGs (fixed), MINORs fixed or kept with reasons; in full in .claude/plans/held-8959.md
**Asked (awaiting user):** 0

### Validation
- Full validation: passed on Mortals 01:01 CST 2026-11-28 (mortals-validate.sh, rc 0, remote hash equal to the local one, 88faecd94efc, head 10cd6b481d; 31,932 node tests, 0 failed), on main with D1d2a. Only this proof file changed after it.
- Two earlier Mortals runs went red. 00:07 (4aa8d88f6f): MY defect, the moderation queue request was built as a literal plus a suffix, which server.ios-routes-6838 refuses; fixed in 10cd6b481d (one literal with interpolation). 00:27 (10cd6b481d): cli.community-words-and-piped-9238's timing bound (3614 ms against a 3 s read under load), not this change; the file alone was 28/28 three times; the same head then passed.
- Logic: run-held.sh 63/63, compiled with -Onone (kosmos#9213); server.ios-routes-6838 5/5; all 17 iOS node test files 102/102; the #9104 guard and the ui-sample shard test 6/6.
- subdir CLAUDE.md audit: passed.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus

- [WARNING] a short post of more than 4 lines was clamped with no Read all, so a person could release lines they never saw: Read all also shows past 4 lines FIXED
- [NIT] the post link's style; a timed-out release said "could not release" (now "could not finish", and the list is read again); an open discard ask stayed enabled during a release; an empty remotePostId; the UI test's words-hidden check; added tests FIXED

#### Iteration 2
**Reviewer model:** sonnet

- [WARNING] every row was still clamped at 4 lines, and the phone wraps by width: a row is clamped only when Read all is offered beside it FIXED
- [WARNING] the UI test checked a row's words after scrolling past it: checked while the row is on screen FIXED
- [NIT] a timed-out discard: "could not finish", list read again FIXED
- [NIT] a timed-out release pressed again: kept, safe (the board refuses a row no longer held, so nothing publishes twice)

#### Iteration 3
**Reviewer model:** opus

- [NIT] buttons came back before the re-read after a done release; the "shows where it stands now" line outlived a failed re-read; a failed Community read dropped the policy wording; "Releasing..." in the error colour FIXED
