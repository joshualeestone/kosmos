# Plan: the create-ping Settings row says "On by default" (kosmos#2020)

Routed by Splinter (2026-09-05) as a side-task while PR-C2 waits for Renet's flow.

## Problem

The Settings row "Let the Kosmos team know when you create an agent" (`#tell-row`,
the create-ping telemetry OPT-OUT) still read "Off by default". But Josh flipped
the create-agent ping default ON (#2020/#2013, 2026-09-05; `engine/ping.js` read()
returns `{ on: true }` on ENOENT, line 75). The #2020 branch that restored the
CONTROLS honestly said "Off by default" then, because the default flip was held for
Josh (the irreversible half); a comment even predicted it would become "On by
default" when he flipped it. He flipped it, but the wording swap never happened.

So a telemetry OPT-OUT row claimed it was off while the engine sends by default -
a stale-copy correctness bug: it tells a person "nothing is sent" when something is.

## The call

- Correct the copy: "Off by default." -> "On by default; this switch turns it off."
- Update the row's comment to record that the flip happened (the wording swap it
  predicted).
- ONLY the create-ping `#tell-row`. The phone-notification row below (engine/notify.js,
  `notify.read()` defaults `on:false`) genuinely stays OFF by default and is untouched;
  the comment says so explicitly.
- Guard against recurrence in `docs/browser-checks/render-optout-403-2020.js`, which
  already asserts `tell-toggle` reads its ON default: also assert a default-ON
  switch's descriptive copy does not claim "Off by default". Satisfies the #1720
  web-change gate.
- Fix two stale SIBLING comments the challenge sweep found (server.test.js,
  engine/notify.test.js) that repeated the same false "create-ping off by default"
  belief.

## What I rejected

- Removing the "default" clause entirely: the #2013 principle is that a switch
  should state its default; "On by default" is the accurate statement, so keep it.
- Touching the notify row or the reply-where/eng row: those are genuinely OFF /
  a different setting; sweeping them would be wrong.
- Changing the darwin/product phrasing beyond the factual default: Josh owns the
  final copy; this is the minimal factual correction Splinter authorized.

## Weakest premise

That create-ping truly defaults ON. Verified three ways: `engine/ping.js:75`
(ENOENT -> on:true), the ping.js header comment ("Josh 2026-09-05, #2020/#2013"),
and Splinter's own instruction. All consistent.

## Verification

- Affected source tests green (server 265/265, notify 6/6, create-tell 11/11,
  switch-markup 2/2, reply-where 10/10, feedback-switch 5/5).
- Repo sweep: no other stale create-ping "off by default" claim remains.
- Challenge-loop converged in 2 iterations (iter 2: zero findings, 4 strengths).
- Render evidence: the render-optout-403-2020 page-layer check (its new default-ON
  copy assertion + the existing tell-toggle ON-state assertion) run via the harness.

## Notes

- Merge held for Splinter's launch-cut merge-freeze; rides the launch cut.
