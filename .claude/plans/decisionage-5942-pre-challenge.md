---
method: challenge-loop
branch: decisionage-5942
diff_hash: af8980f6e72e08ecc89f09850bea0d100df8a6238dcf7517c4375ae9dac692c2
iterations: 15
converged: 2026-10-12
---

# Pre-PR review proof, kosmos#5942

Converged after 13 iterations, each a fresh blind reviewer, alternating opus and sonnet. Round 13 found
nothing new. The ledger below is taken from the commit bodies on the branch, one commit per round.

#### Iteration 1
- [WARNING] The card kept askedAt even when the report's state was not the card's (a question read off the
  screen over an older blocked report is another wait). Now kept only when the states match, on the card's own
  clock; both card paths tested on a real board.
- [WARNING] render-tasks-view-3559 did not render the line through the page's own read. Now it does.
- [NIT] The oldest-holder age documented as a lower bound.

#### Iteration 2
- [WARNING] The browser arm did not unroute on failure. Now unroutes in a finally, and says its no-age half
  holds only until #5943 gives cards a real start.
- [NIT] One comment's wording.

#### Iteration 3
- [WARNING] Both "no known start" halves would turn red once #5943 merged. Each now forces waitingSince to null
  itself (browser arm through the route, engine test on the card).
- [NIT] Comment order on the wait line; the plan says blocked never shows an age.

#### Iteration 4
- [WARNING] The browser arm unrouted handlers it did not own. Now only its own.
- [NIT] The plan records the real-read arm owed once #5943 merges.

#### Iteration 5
- [WARNING] waitingOnPerson and waitingSinceOf could pick different cards. They now share one rule
  (cardsNeedingPerson), so the red and the age cannot disagree.
- [NIT] Docblock trimmed to what the code guarantees; the route's field list names waitingSince.

#### Iteration 6
- [WARNING] A task with a waiting holder of unknown start could show a too-short age. It now shows none (tested).
- [NIT] The #5034 comment moved onto the shared rule it describes; the plan records Angel's per-project askedAt runs.

#### Iteration 7
- [WARNING] The Tasks route was not tested to carry waitingSince. Now tested on a decision row and null on
  another, proved to fail without it.
- [NIT] waitingSinceFrom docblock says only what the state check enforces.

#### Iteration 8
- [NIT] The route test restores selfreport.read even if the fleet install throws.

#### Iteration 9
- [WARNING] A card needing the person for another reason (crash loop, stuck error, trust wait) could carry an
  older blocked start. Only a needs_you card's start now counts; any other makes the age unknown (tested).
- [WARNING] A missed repeating run waiting alongside an agent now gives no age.

#### Iteration 10
- [NIT] False comment clauses removed; the plan says which side drops a non-question start; the route reads the
  missed-run state once so its two uses agree.

#### Iteration 11
- Rebased onto main with #5943 (eae4ad58b). Added the owed real-card arm with no selfreport.read wrapper.
  status.waitingsince-5942.test.js 4/4.

#### Iteration 12
- [NIT] The real-card arm recorded one report, so askedAt equalled the report's at and could not tell them
  apart. It now re-reports 15 ms later and asserts askedAt != at before comparing. Negative control:
  waitingSinceFrom reading .at instead of .askedAt fails all four tests (restored, byte-identical).

#### Iteration 13
- Clean. No new findings.

#### Iteration 14 (after the PR opened: CI browser-checks red)
- [WARNING] The #3559 rule in render-tasks-view-3559 forbade "Waiting on you" anywhere on the Tasks panel, and a
  decision row's age line now says exactly that. I had not re-run browser checks after rebasing onto #5943. The rule
  is about groups, so it now reads the panel without rows' own wait lines, and a new check asserts every removed
  line is a wait line.

#### Iteration 15 (blind review of iteration 14)
- [WARNING] The removed-line pattern accepted anything after "for". Now it names agoWords' real units (15 real
  outputs match, 3 bad strings rejected).
- [WARNING] The removal and assertion now read `.tsk-row .tsk-waiting`, matching the label.
- [NIT] A stale "until #5943 merges" comment corrected. Declined: asserting exactly one wait line on the main read
  (that count depends on the fixture agent's report, not on this change).

## Full validation
See the PR body for the result of the full queued validation run.
