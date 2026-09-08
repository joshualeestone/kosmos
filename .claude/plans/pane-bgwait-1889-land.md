# Plan: land the #1889 background-wait pane reader + #2378 (adopting panefixtures-1889)

## What this is

An adoption/land of Mikey's `panefixtures-1889` branch (kosmos#1889), which he built over 25 review
rounds and never PR'd. Mikey is off-roster (moved to the pitch deck); Josh flagged #1889 as
Kosmos-team-owned; Splinter routed the resolution to me. Pane-readers are my founding lane. The
full 25-round history, every defect and every retraction, is in `.claude/plans/panefixtures-1889.md`
(preserved verbatim; read the retractions first, per Mikey - that is where the branch's real shape
is). This file is the LANDING plan on top of that.

## What lands (net diff vs current origin/main, +3522)

- **engine/status.js (+901):**
  1. The **background-agent wait reader** (#1889/#1884 class): a pane showing
     `✻ Waiting for N background agents to finish` classified `idle` on a mid-work agent
     (no gerund, no timer, so `WORKING_LINE` cannot match). The board was only "right" where the
     agent's own self-report hook happened to cover it - a much weaker guarantee than a second
     reader. Captured live from a real 2.1.258 pane.
  2. **kosmos#2378 (Ice Cream Kitty's INTERRUPT_LINE)**: `INTERRUPT_LINE_LIVE` (spinner-glyph
     anchored) + `hasLiveInterruptLine`, replacing the old unanchored `INTERRUPT_LINE`, so a
     QUOTED "esc to interrupt" in prose no longer reads working. Rides this branch; #2378 cannot
     land without it.
  3. A **reconcileReport rule-5 exemption**: a decayed report during a background wait is correct,
     not suspicious (the report hook cannot heartbeat while only a background agent runs).
- **engine/chat.js (+28):** `backgroundWait` threaded to `chat.waitingNote` (it gated a false
  "your message will go unread" sentence) and #1966's account badge.
- **Tests (+1319 across status.test.js, chat.test.js, status.observed-1921, waitingnote-provider):**
  the 25 rounds' worth of fixtures and guards.

## The one reconciliation this land required

Merging current main (which carries my #2456) surfaced ONE semantic regression: a #2456 arm asserted
a `⎿  running ... (esc to interrupt)` line below a prose question reads WORKING, which held on main
only via the old unanchored matcher #2378 correctly retired. Fix: the #2456 fixture now uses the
realistic spinner-glyph shape `· Running the check (5s · esc to interrupt)`, which both matchers
catch; #2378's tightening and its false-positive guard are untouched. See the commit and the #1889
comment. Full suite green (5284/5284) after it.

## Approach and decisions

- **Merge, not rebase.** `git merge-tree` showed 0 textual conflicts (Mikey's status.js additions
  are disjoint from main's 70-commit churn), so a clean merge of current main brought the branch
  up to date without replaying 47 commits of round-by-round churn. The PR squashes anyway.
- **Fix the fixture, not the matcher**, for the #2456/#2378 collision - #2378's spinner-shape
  requirement is correct (it kills a real false positive), and `⎿` is a result glyph not a live
  line. Flagged for Kitty in case `⎿` is ever a real shape she wants caught.
- **#2378 coordination at land**: its release check is CONTENT-based (INTERRUPT_LINE_LIVE count 2,
  hasLiveInterruptLine 3 in engine/status.js; both 0 on main). Loop Ice Cream Kitty in before/at
  merge so her card lands with the branch and does not strand.

## Weakest premise

That the merge is semantically clean beyond the one reconciled arm. Mitigation: the full suite
(5284 tests, including Mikey's +1155 status arms and my #2456 arms) is green on current main, and
the mandatory challenge-loop re-reviews the whole net diff against current main before the PR.
