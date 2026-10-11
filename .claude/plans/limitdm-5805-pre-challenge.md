---
pre_challenge: true
method: challenge-loop
branch: limitdm-5805
diff_hash: 6482e31e8f130580f6260868fbc51c2cb556e49cd6d6591e3b4d005282adcf9b
validation: passed (Mortals full suite at 0bd78e23a, 18956 tests, 18713 pass, 0 fail, 0 cancelled, browser-check gates green, 2026-10-11 03:44 CDT; local helper skipped on that clean entry, hash 6482e31e8f13)
subdir_audit: passed
timestamp: 2026-10-11T08:44:51Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4 found no new issues)
**Reviewer models:** alternating opus (odd) and sonnet (even).

Note: after convergence, two Mortals full-suite runs each found a gap the review did not, both fixed before the passing
run: the menu check read the pane on every person DM (a scripted-runner test lost an entry; an ordinary send cost an
extra capture), and a JS variable named `msg` tripped the browser-check surface gate. Findings and dispositions are in
.claude/plans/limitdm-5805.md, copied here.

Note on 6.0: no local full suite (the shared Agent1s queue); the full suite ran on Mortals.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- FIXED: Send now anyway pressed while the minute sweep was typing the same message typed it twice; a message being
  typed is claimed (limitqueue.isTyping) and the route answers 409 for it (tested).
- FIXED: a held message whose row could not be recorded was kept where the person could not see it (the page then
  put the words back as unsent); it is taken back out and typed now (tested).
- FIXED: a row whose update failed (lock busy) stayed "Held" for a message already typed or dropped; limitqueue.setRow
  keeps the update and the next sweep writes it (tested). A Send now anyway whose typing throws marks the row not
  delivered instead of leaving it held. In memory only: a board restart leaves such a row held (residual).
- FIXED: the "behind" path had no test (now tested); the page reads a structured `behind` flag, not the server's
  wording; queue ids carry a random suffix so two sends in one millisecond stay two.
- CONVENTION taken: the Send now anyway route sits above the thread docblock, not between it and its route.
- Not taken: telling reactions only once across held messages (the route's own rule: telling twice costs one note);
  a retry path when Send now anyway comes back could not deliver (the row says so; the person can send again).

#### Iteration 2
**Reviewer model:** sonnet
- FIXED: a held row stored without `behind`, so after a reload a message held behind kept ones read "out of usage";
  appendLocked keeps it (tested by reading the row back).
- FIXED (decided): the terminal composer and the assistant bar post to the same route and have no held state, so they
  showed a kept message as not delivered. They send `anyway: true`, typed straight in as before: the terminal box is
  where a person answers a limit menu. Only the DM thread, which shows Held and Send now anyway, holds (tested).
- FIXED: Send now anyway took the message out of the queue before typing it, so a board that stopped mid-typing lost
  it; it now claims it (the sweep skips a claimed message), types, then removes it, and a failed removal is
  remembered so the sweep never types it again (tested: still kept while typing, gone after).
- NIT taken: the sweep hooks' comment sits on sweepHooks.

#### Iteration 3
**Reviewer model:** opus
- FIXED: a person's message was held while the agent's screen waited on an answer, so nothing could answer it. Never
  held while a question or permission menu is up, or past the reset while Claude Code's limit menu is on screen (the
  person may be answering it); before the reset the hold stands (tested, with controls).
- FIXED: a held message the sweep could not type for a lasting reason still read as only waiting for the reset. The
  row stays held, keeps its time and flags, and records why (`stuck`, written once per reason); the row and the line
  under the box say "Kosmos tried to send it and could not: ..." (tested).
- FIXED: claim() accepted an id already typed whose removal had failed, so Send now anyway could type it twice; it
  answers 409 (tested by making the removal fail).
- FIXED: Send now anyway re-enabled silently on a refusal other than 409; it says the route's error under the box
  (tested; a 409 still repaints, not an error).
- Rebased onto limitmsg-5805 807b2a4ae (2a converged at iteration 20); claim() uses 2a's claim Map (stale after an hour).
- NITs declined: setRow retry for permanent misses, same-millisecond `at`, member-panel button, settle on could_not.

#### Iteration 4
**Reviewer model:** sonnet
- NO NEW ISSUES. CONVERGED at iteration 4.
- STATED (residual): past the queue's caps a person's message is typed as before, with no held row.
- NIT not taken: a stuck reason read off a hold verdict says "tried" when nothing was typed; the row is still true
  about why it waits.

**Found after iteration 4 (not by a reviewer):**
- FIXED: the menu check (review 3 fix 1) read the pane on EVERY person DM, not only one that would be held, so a
  scripted-runner test (server.projects "a button answer that never reached the pane") lost a runner entry and an
  ordinary send cost an extra capture. The check runs only when the message would otherwise be held.
- FIXED (second Mortals run): the browser-check surface gate (#2518) refused 2b because Send now anyway's under-box
  variable was named `msg`, a token render-unread-edge-3743 and render-agentdm-3414 map; renamed (`under`), gate green
  locally and red with the old name.
