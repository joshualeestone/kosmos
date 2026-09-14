# Plan: #2632 - Prompter toggle copy overstates after #2623 removed its delivery

Card: joshualeestone/kosmos#2632 (a #1722 follow-on). Branch: `prompter-copy-2632`.

## The problem
The Settings > Automation "Check on your agents" (Prompter) toggle hint reads
"Every so often, Kosmos looks at which of your agents are working and asks you to
check on any that have stopped." #2623 (merged) deleted the phone-home notify seam,
which carried the heartbeat's `check_in` - the toggle's only delivery path. engine/
heartbeat.js's own header confirms it: the runner still computes which agents stopped,
but "server.js no longer delivers the result anywhere off the Mac. A future in-app
delivery channel is a separate build." The relay endpoint never existed, so this
toggle has in fact never notified a user. The copy promises a notification that does
not happen - the "affordance a degraded state cannot honour" failure.

## Decision (my lane = copy; reversible; not parked on Josh)
Two honest fixes exist: (1) soften the copy so it stops promising a notification, or
(2) hide the toggle until an in-app delivery channel exists. Hiding is the fuller fix
(a broken control is worse than plain text), but it is a paint change (paintHeartbeat
un-hides the toggle on status read) - Angel's implementation lane, and it removes a
control Josh set on-by-default. So:
- SHIP (my lane): soften the hint + aria-label so they no longer promise an
  undeliverable notification, and correct the stale #1722 comment that still claims
  "the control is not a dead toggle."
- ROUTE (Angel/Josh): recommend hiding the Prompter toggle until in-app delivery
  exists, recorded on the card and in the code comment.

Rejected: restoring the check_in on an in-app channel (that IS the separate build the
heartbeat header names - implementation, not copy).

Weakest premise: that Josh prefers a softened-copy toggle over hiding it outright. If
he wants it hidden, that is the routed recommendation; one paint change does it.

## What finished looks like
- The hint no longer says "asks you to check on any that have stopped"; it states
  honestly that Kosmos checks, and that it can't nudge you about them yet.
- The aria-label no longer promises the ask; it names the control ("Check on your
  agents"), keeping WCAG label-in-name (contains the visible label).
- The #1722 code comment reflects that #2623 removed delivery.
- Full suite green. No test pins the copy strings (verified), so none needs updating.

## Gate
- #1720: copy-only web/ change, no docs/browser-checks/ file touched -> Browser-check: trailer.
- #2518: hb-toggle is not a mapped surface token -> not triggered.
