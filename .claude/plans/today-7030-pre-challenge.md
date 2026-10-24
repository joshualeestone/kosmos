---
pre_challenge: true
method: challenge-loop
branch: today-7030
diff_hash: ef8bcd28183e01caf34aa183466a3562f40d1b9ede9cbe5cc18052aab7b4e5e4
validation: passed
subdir_audit: passed
timestamp: 2026-10-24T08:00:06Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 blind reviewers (opus, opus, sonnet), each given the code, not my conclusions.
**Converged:** Yes (iteration 3: minors only; one became Mona Lisa's ruling, one a pinned decision, one recorded as covered by source)
**Fixed:** 2 blockers, 2 majors and 7 minors across rounds 1 to 3 | **Deferred:** none | **Asked:** Mona Lisa, twice (stuck_rate stays separate; a screen-read wait is 'waiting')

Validation at 0911db0907 (origin/main not ahead at proof time):
- Focused run through tools/run-tests.sh --only via queued-heavy.sh (started 02:59:06, after the last commit): server.todayreason-7030, server.statusword-7004, engine/cardlabel-5959, server.test.js. END rc=0: 385 tests, 385 pass, 0 fail, 0 skipped.
- Both browser-check gates run directly on the branch (--only skips them): coarse 0, surface 0 (no web/ change).
- Mutants, each made on a committed tree and restored, each turning the new test red: the present/tied fix, the tie, failed restart, offline trust before a crash loop, the crash loop, agent-reported question, permission versus waiting, needsYouReasonPastUsage, the tone gate, the reason and project-name fields, and the projects read's guard.
Subdirectory CLAUDE.md audit: none under engine/.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [BLOCKER] needsYouReason needs present and tied, which only project member rows carry: on real /api/status rows every reason but question and permission was 'other' (measured by the reviewer). Fixed: a listed row is present and tied.
- [BLOCKER] the tests' hand-built cards supplied that premise. Fixed: every reason test starts from a real status row, with a premise test.
- [MAJOR] a failed restart read as a question. Fixed: restart_failed (the board's pjAlsoWhy words).
- [MAJOR] the order contradicted the card's word for a crash-looping needs_you agent. Fixed: the board's order.
- [MINOR] needsYouReasonPastUsage, so a rate limit never hides a real reason. Fixed.
- [MINOR] an offline trust card looked quiet. Fixed, then found wrong in round 2 (see below).

#### Iteration 2
**Reviewer model:** opus
- [MINOR] the offline-trust fix matched a row the route never builds (real offline trust rows are state needs_trust, already needs_you). Removed, with a premise test of the real shape; Mona Lisa told.
- [MINOR] offline trust must come before a crash loop (the word says trust). Fixed.
- [MINOR] the tie gate made an untied gave-up read 'other'. Fixed: every listed row is tied.
- [MINOR] loose route assertions and an unchecked unreadable-file premise. Fixed.
- [MINOR] a screen-read needs_you as 'question'. Asked Mona Lisa; she ruled 'waiting' (applied in round 3).

#### Iteration 3
**Reviewer model:** sonnet
- [MINOR] an offline crash-looping card reads "Not running" with the crash-loop sentence. Decided: keep it (the sentence says why), pinned in a test.
- [MINOR] stateProjectName is not exercised through the route. Recorded: the fleet cannot give a row a stateProject; the route's use is pinned by source and the name logic directly.
