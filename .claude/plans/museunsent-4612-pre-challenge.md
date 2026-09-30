---
pre_challenge: true
method: challenge-loop
branch: museunsent-4612
diff_hash: 9dda1be750fee67fc5e4ab4ab6f55abef58674329ba035af35b22830e3bed91a
subdir_audit: passed
timestamp: 2026-09-30T15:07:26Z
iterations: 12
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 12 blind reviews in two loops (opus and sonnet alternating). The first loop (6 rounds) reviewed the first version. The branch was then rebased onto a changed museqcard-4569 (#4611), so a second, fresh loop of 6 passes reviewed it again from nothing.
**Converged:** Yes. Fresh pass 6 returned no BLOCKER and no CONVENTION. Its two WARNINGs are not new defects: one repeats pass 4's accepted limit, the other describes an ordering that cannot happen (reasons below).
**After the loop:** #4611 merged (d4a507f12), and this branch was rebased onto main with `rebase --onto origin/main d65a05d07` (14 own commits, no conflict, no code change), plus one empty commit carrying the coarse browser-check gate's trailer. Nothing reviewed changed.
**One change after that:** the first full run on main failed one test, web.no-left-bars-3692 (the operator's rule: no solid left bar on a card, note or warning). The unsent answer is a blockquote with a 3px left rule. It is a quote of the agent's own words, the same call the rule's list already makes for .detail-said and .msg-replyto, so it was added to that list (bb883ad4e); the look is unchanged. A blind pass on that one commit (sonnet) returned no BLOCKER, WARNING or CONVENTION: it is a real blockquote of the agent's words, its rule uses the same neutral colour and width as the allowed quotes, the list entry matches the selector the test extracts, and the test's stale-entry check is satisfied. One NIT not taken (the entry's reason says "a Muse agent"; only a Muse agent produces this today).
Every fix below was measured red with the fix removed.

## First loop (before the rebase onto the changed #4611)

### Iteration 1 (opus)
- [BLOCKER] The carried answer was the LAST turn's. With the person's DM running first, that was usually a room post, which could put a colleague's room text under the person's DM. Now the answer is the one to the person's latest DIRECT message (the DM envelope), kept across later turns.
- [NIT] owes.unsent's unread `at` was dropped.

### Iteration 2 (sonnet)
- [WARNING] The stop-note path was untested. Added a test, measured red with the envelope matched at the start only, plus tests for a failed later DM and every operatorDirect form.

### Iteration 3 (opus)
- [WARNING] The answer vanished after any later turn, and the DM falsely went back to "Nothing back yet". selfreport now carries the run's latest answer, and the route no longer needs the latest report to be idle.
- [CONVENTION] A control could not fail. It now uses a DM turn that failed with partial words and one with no words.

### Iteration 4 (sonnet)
- [CONVENTION] A comment and the plan did not match the code. Reworded. The answer is now cut by characters in the bridge and selfreport too. Two known limits recorded.

### Iteration 5 (opus)
- [CONVENTION] A plan test line was stale. Fixed, along with two test-shape nits.

### Iteration 6 (sonnet)
- NO NEW BLOCKER/WARNING/CONVENTION.

## Second loop (fresh, after the rebase)

### Iteration 7 (opus): 0 BLOCKER, 2 WARNING, 0 CONVENTION, 4 NIT
- [WARNING] The DM answer went only on idle, after the queue drained. Fixed: it rides on the working report of the turn queued behind the DM. An idle report between turns was tried first and rejected (it breaks #4569's "idle only once nothing is waiting" and blanks the queue line).
- [WARNING] A newer DM's empty turn did not clear the board's older answer. Fixed with a server test using the newer DM's own working and idle reports; the plan's weakest premise and a comment were rewritten to say what the code does.
- The needs_you "not kept" controls were vacuous (a needs_you with no reason is refused). They now carry a reason and assert it was recorded.

### Iteration 8 (sonnet): 0 BLOCKER, 3 WARNING, 1 CONVENTION, 3 NIT
- [WARNING] A DM queued behind a newer DM was dated by its turn start and could show as the newer DM's answer. Fixed: dated by when the DM reached the front.
- [WARNING] The throw path was untested. Fixed: "a DM turn that throws leaves no answer".
- [WARNING] Any agent can send a final answer. DEFERRED with reasoning: it shows only under that agent's own DM, escaped, and only when not before the owed message, so it says nothing the agent could not post there itself.
- [CONVENTION] The proof file is committed: by design (the gate reads it).

### Iteration 9 (opus): 1 BLOCKER, 2 WARNING, 0 CONVENTION, 4 NIT
- [BLOCKER] (caused by my iteration-8 fix) Arrival time was keyed by text, so the same words sent twice lost the second copy's time. Fixed: a first-in-first-out list of arrival times per text; dropped messages release theirs; a stop note is dated by the stop's arrival.
- [WARNING] The answer rode on every working report and could push older rows out of the tail. Fixed: once on a working report, then the idle.
- [WARNING] Prune and stop depended on text identity. Fixed by the same list.

### Iteration 10 (sonnet): 0 BLOCKER, 4 WARNING, 1 CONVENTION, 2 NIT
- [WARNING] Escape left stale arrival times. Fixed: stop() clears them.
- [WARNING] The DM envelope matched anywhere after a newline, so a room post or digest quoting it was taken for the DM. Fixed: anchored at the start, after an optional stop-note first line; `answersTheDm` is exported and unit-tested against a forged post and a digest.
- [WARNING] The answer is lost while a needs_you or blocked wait stands. DEFERRED by design (the wait matters more); stated in the plan's known limits.
- [WARNING] One answer can use a quarter of the tail. DEFERRED; stated in the plan's known limits.

### Iteration 11 (opus): 0 BLOCKER, 2 WARNING, 0 CONVENTION, 6 NIT
- [WARNING] DMs read in one chunk share an arrival time, so an older DM's answer could pass under the newer one. Fixed (the reviewer's own suggestion): a DM turn with a newer DM already queued carries no answer.
- [WARNING] A comment and the plan said a stop note keeps its turn start. Fixed.
- [NIT] The answer box was not keyboard-reachable (WCAG 2.1.1). Fixed: tabindex, a label, and a visible focus ring.

### Iteration 12 (sonnet): 0 BLOCKER, 2 WARNING, 0 CONVENTION, 3 NIT. CONVERGED
- [WARNING] A large answer can be pushed out of the tail: a DUPLICATE of iteration 10's deferred limit; it fails safe (the old line shows).
- [WARNING] A "reverse race" (a newer DM stamped before the older one reaches the front): DEFERRED, it cannot happen as described. Deliveries to a pane are serialised and each DM is stamped when ITS delivery starts, on one machine clock. Iteration 11's reviewer measured the same.
- NITs not taken, each harmless as is.

## Validation
- Full suite: validation passed (Mortals), recorded for this exact diff hash.
- The six files this change touches (engine/musefront, engine/selfreport.waiting-4569, server.dm-owes-4340, server.report-readback-2709, web.dm-unsent-4612, render-talk-goldencard-2519): 101 of 101 on the rebased tree.
- Every page test (293 web.*.test.js files and server.runners): 2211 of 2211 after the left-bar list entry.
- Both browser-check gates pass on the rebased tree (coarse #1720 by trailer, surface #2518 by trailer).
- render-dm-owes-4340 ran green on this branch at 369635a71, before the rebase onto main. It was NOT re-run locally after the rebase: it is in the gated list, so the PR's browser-checks job runs it on the merge tree, and the PR merges only on full green.

## Weakest premise
- That the DM envelope marks the turn that answered the person, and that the answer's time follows the DM's stored time. The route falls back to "Nothing back yet" whenever that does not hold, and never shows a wrong answer.
- No real Muse agent has been watched doing this. Everything is proven through a stand-in Muse and the page's own functions.
