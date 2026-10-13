---
pre_challenge: true
method: challenge-loop
branch: answeredq-5943
diff_hash: bb5722937ccdfe117a1629b37b514d3b0c75311b985b75cf56b5a537d584903e
validation: pending (Mortals run queued; PR CI runs the full suite and the browser checks)
subdir_audit: passed
timestamp: 2026-10-12T21:19:48Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (opus, sonnet, opus, sonnet)
**Converged:** Yes (iteration 4 raised one NIT, fixed)
**Browser checks:** the 18 surface-mapped DM checks plus render-dmchoices-5406 (new ANSWERED arm), all PASS on the rebased branch; both browser-check gates pass (18 per-check trailers).
**After convergence, at Mona Lisa's request (#5942 reads askedAt), each with a test and a control:** an ask is the same state, words AND project (as carried); askedAt is null when the run may predate the read tail. Focused suites 54/54.

## Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] dated+clearable applied to a screen question while a report stands (permission menu, Codex/Gemini later prompt) --> FIXED (only when question === reportedQuestion; server test arm)
- [WARNING] note rode every message (no told record) --> FIXED (once per ask, marked on PLACED)
- [WARNING] note stored in a usage-limit-held message, false by release --> FIXED (held trailer keeps reactions only)
- [NIT] same words posted just before the report doubled --> FIXED (60 s window, test + control)
- [NIT] question row set DM_ROWS_OLDEST --> FIXED (skipped)
- [NIT] CLI asked one question then said both --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] once-per-ask note spent on a non-answer --> FIXED (re-note after 6 h, test both sides)
- [WARNING] typed duplicate lost age + clear button --> FIXED (agent's own row carries questionClearable/questionAt; tests)
- [NIT] docblock said appended / at null --> FIXED
- [NIT] note quoted the tick-old card words --> FIXED (rep.because)
- [NIT] permission wait still offered clear --> FIXED (GET excludes isAutoPermissionWait)
- [NIT] ask older than the 200-row window sorts first in the tail --> DEFERRED (cosmetic, very long threads only)

#### Iteration 3
**Reviewer model:** opus
- [WARNING] clear could clear a newer, unseen question --> FIXED (button sends askedAt; route answers stale and writes nothing; server test + control)
- [WARNING] CLI reminder never reached Windows; comment claimed it did --> FIXED (board returns it as the report note; both CLIs print it; comment corrected)
- [NIT] browser-check order arm cannot fail on placement --> FIXED (relabelled; placement pinned in server test)
- [NIT] engine control mislabelled --> FIXED
- [NIT] read-aloud spoke the age --> FIXED (.dmq-foot stripped)

#### Iteration 4
**Reviewer model:** sonnet
- [NIT] stale clear repainted silently --> FIXED (says nothing was cleared)

## Rebase onto main (after convergence)
PR #5979 was CONFLICTING (no CI ran). Rebased onto main: one conflict in server.js, the held-DM block, where main's #5948 added a sign-in hold. Resolved by keeping main's signin and until lines and this branch's trailer (no question note in a held message). Focused after rebase: the four #5943 suites, defaults, the #5805 limit suites, both #5948 suites, doctrine: 119/119. File-scanning guards (fixture-discipline, no-brand-refs, no-name-refs, engine.reachable, install.reachable, the three Windows guards): 116/116.

## PR CI found two existing tests asserting the old behaviour
suite (node) on #5979 failed two tests outside the focused set: server.blocked-owner-person-5318 asserted needs_you gets no note (this branch deliberately returns the asking reminder), and web.thread-shape-3966's stub accepted only the .mwhen selector (refreshWhens now also refreshes .dmq-age). Both updated to the new behaviour: the #5318 arm still proves needs_you never gets the blocked-owner note, and the #3966 stub records both selectors. Then every test file mentioning refreshWhens, threadShape, needs_you, report clear, dmq-, askedAt or .note was run: 126 files, 3099/3099.

## Second rebase (16:1x CDT): doctrine renumbered to v30
Main gained #5920's doctrine v29 while this branch also claimed v29, so the PR went CONFLICTING. Rebased: kept #5920's log entry 29, this branch's entry is now 30 and DOCTRINE_VERSION 30; engine/doctrine-past.js is main's table plus the new v30 row and its one new section hash (the generator, run on this branch, would have dropped rows main holds, so the union was taken instead); defaults.test.js pins v29 (main's) and v30. Related tests 3526/3526 (135 files plus the file-scanning guards); doctrine suites 116/116. The Mortals run that ended red at 16:16 tested a3e64b9d8 and failed only the two tests already fixed here.
